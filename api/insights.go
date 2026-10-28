package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
)

const dailyPrompt = `You coach someone through a fat-loss phase while they lift weights.
You get one day's log as JSON: targets, totals, food entries with times, steps, weight, hunger and work focus (1-5), sleep, notes, and the previous 7 days.
Write at most 3 bullet points, under 70 words in total, each starting with "- ".
Each bullet points at something specific in the data (a time, an entry, a number) and gives one concrete thing to do tomorrow. Put the most important first.
Plain words. No greeting, no praise padding, no medical claims. If food or weight is missing, say so in one bullet.`

const weeklyPrompt = `You coach someone through a fat-loss phase while they lift weights.
You get one week's log as JSON: targets, each day's totals, meal times, steps, weight, hunger and work focus (1-5), sleep, workouts, and the 7-day average weight trend.
Find up to 3 patterns across days (meal timing, protein, steps, weekdays versus weekend, hunger versus intake, weight trend) and give one concrete change for next week for each.
At most 3 bullet points, under 120 words in total, each starting with "- " and tied to specific days or numbers.
Plain words. No greeting, no praise padding, no medical claims. If fewer than 3 days are logged, say the week is too thin to judge and give one tip.`

type insightKind struct {
	model     string
	cooldown  time.Duration
	maxTokens int64
	prompt    string
}

type insighter struct {
	client anthropic.Client
	kinds  map[string]insightKind
	limits limiter
	busy   sync.Mutex
}

// Off unless ANTHROPIC_API_KEY is set. Daily uses a small model; weekly a strong one for patterns.
func newInsighter() *insighter {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		return nil
	}
	return &insighter{
		client: anthropic.NewClient(),
		kinds: map[string]insightKind{
			"daily":  {model: env("NBT_DAILY_MODEL", "claude-haiku-5-5"), cooldown: 6 * time.Hour, maxTokens: 400, prompt: dailyPrompt},
			"weekly": {model: env("NBT_WEEKLY_MODEL", "claude-opus-5-5"), cooldown: 24 * time.Hour, maxTokens: 2000, prompt: weeklyPrompt},
		},
		limits: limiter{max: 12, window: 24 * time.Hour},
	}
}

var periodRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

type insightBody struct {
	Text        string `json:"text"`
	Model       string `json:"model"`
	SummaryHash string `json:"summaryHash"`
	CreatedAt   int64  `json:"createdAt"` // ms, for the browser
	NextAt      int64  `json:"nextAt"`
}

func (s *server) latestInsight(r *http.Request, kind, period string) (*insightBody, error) {
	var b insightBody
	var created int64
	err := s.db.QueryRowContext(r.Context(),
		"SELECT text, model, summary_hash, created_at FROM insights WHERE kind = ? AND period = ? ORDER BY created_at DESC LIMIT 1",
		kind, period).Scan(&b.Text, &b.Model, &b.SummaryHash, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	b.CreatedAt = created * 1000
	b.NextAt = time.Unix(created, 0).Add(s.ins.kinds[kind].cooldown).UnixMilli()
	return &b, nil
}

func (s *server) getInsight(w http.ResponseWriter, r *http.Request) {
	kind, period := r.URL.Query().Get("kind"), r.URL.Query().Get("period")
	if s.ins == nil {
		writeJSON(w, http.StatusOK, map[string]any{"insight": nil, "enabled": false})
		return
	}
	if _, ok := s.ins.kinds[kind]; !ok || !periodRe.MatchString(period) {
		writeError(w, http.StatusBadRequest, "bad kind or period")
		return
	}
	b, err := s.latestInsight(r, kind, period)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"insight": b, "enabled": true})
}

func (s *server) postInsight(w http.ResponseWriter, r *http.Request) {
	if s.ins == nil {
		writeError(w, http.StatusServiceUnavailable, "insights aren't set up on this server")
		return
	}
	var req struct {
		Kind    string `json:"kind"`
		Period  string `json:"period"`
		Summary string `json:"summary"`
	}
	if !readJSON(w, r, &req, 16<<10) {
		return
	}
	k, ok := s.ins.kinds[req.Kind]
	if !ok || !periodRe.MatchString(req.Period) || req.Summary == "" || len(req.Summary) > 8000 {
		writeError(w, http.StatusBadRequest, "bad insight request")
		return
	}
	// One call at a time, so a double tap can't spend twice.
	if !s.ins.busy.TryLock() {
		writeError(w, http.StatusConflict, "an insight is already being written")
		return
	}
	defer s.ins.busy.Unlock()

	prev, err := s.latestInsight(r, req.Kind, req.Period)
	if err != nil {
		serverError(w, err)
		return
	}
	if prev != nil && time.Now().UnixMilli() < prev.NextAt {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "insight is cooling down", "insight": prev})
		return
	}
	if !s.ins.limits.allow() {
		writeError(w, http.StatusTooManyRequests, "daily insight budget used up, try again tomorrow")
		return
	}
	s.ins.limits.record()

	params := anthropic.BetaMessageNewParams{
		Model:        anthropic.Model(k.model),
		MaxTokens:    k.maxTokens,
		System:       []anthropic.BetaTextBlockParam{{Text: k.prompt}},
		Messages:     []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(req.Summary))},
		OutputConfig: anthropic.BetaOutputConfigParam{Effort: anthropic.BetaOutputConfigEffortLow},
		Fallbacks:    anthropic.BetaFallbacksParamOfDefault(),
		Betas:        []anthropic.AnthropicBeta{"server-side-fallback-2026-07-01"},
	}
	// Haiku can skip thinking entirely, which keeps a daily insight to a few hundred tokens.
	if strings.HasPrefix(k.model, "claude-haiku") {
		params.Thinking = anthropic.BetaThinkingConfigParamUnion{OfDisabled: &anthropic.BetaThinkingConfigDisabledParam{}}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	resp, err := s.ins.client.Beta.Messages.New(ctx, params)
	if err != nil {
		log.Printf("insight %s: %v", req.Kind, err)
		writeError(w, http.StatusBadGateway, "couldn't reach the insight writer, try again")
		return
	}
	var text strings.Builder
	for _, block := range resp.Content {
		if t, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			text.WriteString(t.Text)
		}
	}
	if resp.StopReason == anthropic.BetaStopReasonRefusal || strings.TrimSpace(text.String()) == "" {
		log.Printf("insight %s: stopped with %s", req.Kind, resp.StopReason)
		writeError(w, http.StatusUnprocessableEntity, "couldn't write an insight for that")
		return
	}
	log.Printf("insight %s %s: %s, %d in / %d out tokens", req.Kind, req.Period, resp.Model, resp.Usage.InputTokens, resp.Usage.OutputTokens)

	sum := sha256.Sum256([]byte(req.Summary))
	now := time.Now()
	if _, err := s.db.ExecContext(r.Context(),
		"INSERT INTO insights (kind, period, text, model, summary_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		req.Kind, req.Period, strings.TrimSpace(text.String()), string(resp.Model), hex.EncodeToString(sum[:]), now.Unix()); err != nil {
		serverError(w, err)
		return
	}
	b, err := s.latestInsight(r, req.Kind, req.Period)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"insight": b, "enabled": true})
}
