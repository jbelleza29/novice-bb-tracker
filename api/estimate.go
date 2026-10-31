package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
)

const estimatePrompt = `You estimate the nutrition of meals for a calorie-tracking app.
The user describes what they ate in plain words; it may include Filipino dishes.
Split the description into separate foods. For each, give the portion you assumed in household units and grams, and estimate kcal, protein, fat, carbs and fibre for that portion.
When a portion is vague, assume a typical home serving and say so in the portion.
Round kcal to the nearest 5 and grams to whole numbers.
If one assumption moves the total a lot (cooking oil, skin on or off, sauce), say it in note in one short sentence; otherwise leave note empty.
If the text is not food, return no items and say so in note.`

// Raw JSON because property order is the order Claude writes fields in:
// name and portion must come before the numbers, and Go maps sort keys.
var estimateSchema = map[string]any{
	"type":                 "object",
	"additionalProperties": false,
	"required":             []string{"items", "note"},
	"properties": json.RawMessage(`{
		"items": {
			"type": "array",
			"items": {
				"type": "object",
				"additionalProperties": false,
				"required": ["name", "portion", "kcal", "proteinG", "fatG", "carbsG", "fibreG"],
				"properties": {
					"name": {"type": "string"},
					"portion": {"type": "string"},
					"kcal": {"type": "number"},
					"proteinG": {"type": "number"},
					"fatG": {"type": "number"},
					"carbsG": {"type": "number"},
					"fibreG": {"type": "number"}
				}
			}
		},
		"note": {"type": "string"}
	}`),
}

type mealItem struct {
	Name     string  `json:"name"`
	Portion  string  `json:"portion"`
	Kcal     float64 `json:"kcal"`
	ProteinG float64 `json:"proteinG"`
	FatG     float64 `json:"fatG"`
	CarbsG   float64 `json:"carbsG"`
	FibreG   float64 `json:"fibreG"`
}

type mealEstimate struct {
	Items []mealItem `json:"items"`
	Note  string     `json:"note"`
}

type estimator struct {
	client anthropic.Client
	model  string
	limits limiter
}

// Off unless ANTHROPIC_API_KEY is set; the model can be swapped with NBT_MODEL.
func newEstimator() *estimator {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		return nil
	}
	return &estimator{
		client: anthropic.NewClient(),
		model:  env("NBT_MODEL", "claude-opus-5-5"),
		limits: limiter{max: 60, window: time.Hour},
	}
}

// Estimates run as jobs so they finish even if the phone stops waiting.
// POST starts one under an id the client picks; GET reports how it went.
type estimateJob struct {
	Status string     `json:"status"` // pending, done or failed
	Items  []mealItem `json:"items,omitempty"`
	Note   string     `json:"note,omitempty"`
	Error  string     `json:"error,omitempty"`
}

func (s *server) startEstimate(w http.ResponseWriter, r *http.Request) {
	if s.est == nil {
		writeError(w, http.StatusServiceUnavailable, "meal estimates aren't set up on this server")
		return
	}
	var req struct {
		ID   string `json:"id"`
		Text string `json:"text"`
	}
	if !readJSON(w, r, &req, 4<<10) {
		return
	}
	text := strings.TrimSpace(req.Text)
	if !sessionID.MatchString(req.ID) {
		writeError(w, http.StatusBadRequest, "bad estimate id")
		return
	}
	if text == "" || len(text) > 1000 {
		writeError(w, http.StatusBadRequest, "describe the meal in up to 1000 characters")
		return
	}
	// a retried request gets the job that's already there
	if job, err := s.loadEstimate(r.Context(), req.ID); err == nil {
		writeJSON(w, http.StatusOK, job)
		return
	} else if !errors.Is(err, sql.ErrNoRows) {
		serverError(w, err)
		return
	}
	if !s.est.limits.allow() {
		writeError(w, http.StatusTooManyRequests, "too many estimates this hour")
		return
	}
	s.est.limits.record()

	if _, err := s.db.ExecContext(r.Context(), "INSERT INTO estimates (id, status, created_at) VALUES (?, 'pending', ?)", req.ID, time.Now().Unix()); err != nil {
		serverError(w, err)
		return
	}
	s.jobs.Add(1)
	go func() {
		defer s.jobs.Done()
		s.runEstimate(req.ID, text)
	}()
	writeJSON(w, http.StatusAccepted, estimateJob{Status: "pending"})
}

func (s *server) getEstimate(w http.ResponseWriter, r *http.Request) {
	job, err := s.loadEstimate(r.Context(), r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "no such estimate")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *server) loadEstimate(ctx context.Context, id string) (estimateJob, error) {
	var job estimateJob
	var result string
	err := s.db.QueryRowContext(ctx, "SELECT status, result, error FROM estimates WHERE id = ?", id).Scan(&job.Status, &result, &job.Error)
	if err != nil {
		return job, err
	}
	if result != "" {
		var out mealEstimate
		if err := json.Unmarshal([]byte(result), &out); err != nil {
			return job, err
		}
		job.Items, job.Note = out.Items, out.Note
	}
	return job, nil
}

func (s *server) runEstimate(id, text string) {
	start := time.Now()
	out, msg := s.est.estimate(text)
	status, result := "failed", ""
	if msg == "" {
		b, err := json.Marshal(out)
		if err != nil {
			log.Printf("estimate %s: %v", id, err)
			msg = "couldn't estimate that meal"
		} else {
			status, result = "done", string(b)
		}
	}
	log.Printf("estimate %s: %s in %s", id, status, time.Since(start).Round(100*time.Millisecond))
	if _, err := s.db.Exec("UPDATE estimates SET status = ?, result = ?, error = ? WHERE id = ?", status, result, msg, id); err != nil {
		log.Printf("estimate %s: %v", id, err)
	}
}

// Returns the estimate, or a message for the user when it failed.
func (e *estimator) estimate(text string) (mealEstimate, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	resp, err := e.client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(e.model),
		MaxTokens: 8000,
		System:    []anthropic.BetaTextBlockParam{{Text: estimatePrompt}},
		Messages:  []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(text))},
		OutputConfig: anthropic.BetaOutputConfigParam{
			Effort: anthropic.BetaOutputConfigEffortLow,
			Format: anthropic.BetaJSONOutputFormatParam{Schema: estimateSchema},
		},
		// a policy decline is retried on the server's default fallback model
		Fallbacks: anthropic.BetaFallbacksParamOfDefault(),
		Betas:     []anthropic.AnthropicBeta{"server-side-fallback-2026-07-01"},
	})
	var out mealEstimate
	if err != nil {
		var apiErr *anthropic.Error
		if errors.As(err, &apiErr) {
			log.Printf("estimate: API %d: %v", apiErr.StatusCode, err)
		} else {
			log.Printf("estimate: %v", err)
		}
		return out, "couldn't reach the estimator, try again"
	}
	if resp.StopReason == anthropic.BetaStopReasonRefusal || resp.StopReason == anthropic.BetaStopReasonMaxTokens {
		log.Printf("estimate: stopped with %s", resp.StopReason)
		return out, "couldn't estimate that meal"
	}
	for _, block := range resp.Content {
		if t, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			if err := json.Unmarshal([]byte(t.Text), &out); err != nil {
				log.Printf("estimate: %v", err)
				return out, "couldn't estimate that meal"
			}
		}
	}
	if len(out.Items) == 0 {
		if out.Note != "" {
			return out, strings.TrimSuffix(out.Note, ".")
		}
		return out, "no foods found in that description"
	}
	return out, ""
}

// Jobs cut off by a restart never finish; old ones aren't needed once the client has them.
func tidyEstimates(db *sql.DB) error {
	if _, err := db.Exec("UPDATE estimates SET status = 'failed', error = 'the server restarted, try again' WHERE status = 'pending'"); err != nil {
		return err
	}
	_, err := db.Exec("DELETE FROM estimates WHERE created_at < ?", time.Now().Add(-7*24*time.Hour).Unix())
	return err
}
