package main

import (
	"context"
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

func (s *server) estimate(w http.ResponseWriter, r *http.Request) {
	if s.est == nil {
		writeError(w, http.StatusServiceUnavailable, "meal estimates aren't set up on this server")
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if !readJSON(w, r, &req, 4<<10) {
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" || len(text) > 1000 {
		writeError(w, http.StatusBadRequest, "describe the meal in up to 1000 characters")
		return
	}
	if !s.est.limits.allow() {
		writeError(w, http.StatusTooManyRequests, "too many estimates this hour")
		return
	}
	s.est.limits.record()

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	resp, err := s.est.client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(s.est.model),
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
	if err != nil {
		var apiErr *anthropic.Error
		if errors.As(err, &apiErr) {
			log.Printf("estimate: API %d: %v", apiErr.StatusCode, err)
		} else {
			log.Printf("estimate: %v", err)
		}
		writeError(w, http.StatusBadGateway, "couldn't reach the estimator, try again")
		return
	}
	if resp.StopReason == anthropic.BetaStopReasonRefusal || resp.StopReason == anthropic.BetaStopReasonMaxTokens {
		log.Printf("estimate: stopped with %s", resp.StopReason)
		writeError(w, http.StatusUnprocessableEntity, "couldn't estimate that meal")
		return
	}

	var out mealEstimate
	for _, block := range resp.Content {
		if t, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			if err := json.Unmarshal([]byte(t.Text), &out); err != nil {
				serverError(w, err)
				return
			}
		}
	}
	if out.Items == nil {
		out.Items = []mealItem{}
	}
	writeJSON(w, http.StatusOK, out)
}
