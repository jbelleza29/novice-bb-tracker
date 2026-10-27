package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net/http"
	"regexp"
	"time"
)

type server struct {
	db       *sql.DB
	passcode [32]byte
	limits   limiter
}

// Matches JS Date.toISOString(), so stored dates sort correctly as text.
const isoMillis = "2006-01-02T15:04:05.000Z07:00"

var sessionID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("POST /api/logout", s.logout)
	mux.Handle("GET /api/state", s.auth(s.getState))
	mux.Handle("PUT /api/state", s.auth(s.putState))
	mux.Handle("GET /api/sessions", s.auth(s.listSessions))
	mux.Handle("PUT /api/sessions/{id}", s.auth(s.putSession))
	mux.Handle("DELETE /api/sessions", s.auth(s.deleteSessions))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	mux.Handle("/", staticHandler())

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		mux.ServeHTTP(w, r)
	})
}

type stateBody struct {
	State   json.RawMessage `json:"state"`
	Version int64           `json:"version"`
}

func (s *server) loadState(r *http.Request) (stateBody, error) {
	var data string
	var body stateBody
	err := s.db.QueryRowContext(r.Context(), "SELECT data, version FROM app_state WHERE id = 1").Scan(&data, &body.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return body, nil
	}
	body.State = json.RawMessage(data)
	return body, err
}

func (s *server) getState(w http.ResponseWriter, r *http.Request) {
	body, err := s.loadState(r)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

// Optimistic concurrency: the write only lands if baseVersion is still current.
// On conflict the client gets the current state back, merges and retries.
func (s *server) putState(w http.ResponseWriter, r *http.Request) {
	var req struct {
		State       json.RawMessage `json:"state"`
		BaseVersion int64           `json:"baseVersion"`
	}
	if !readJSON(w, r, &req, 1<<20) {
		return
	}
	state := bytes.TrimSpace(req.State)
	if len(state) == 0 || state[0] != '{' {
		writeError(w, http.StatusBadRequest, "state must be an object")
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	var res sql.Result
	var err error
	if req.BaseVersion == 0 {
		res, err = s.db.ExecContext(r.Context(),
			"INSERT INTO app_state (id, data, version, updated_at) VALUES (1, ?, 1, ?) ON CONFLICT (id) DO NOTHING", string(state), now)
	} else {
		res, err = s.db.ExecContext(r.Context(),
			"UPDATE app_state SET data = ?, version = version + 1, updated_at = ? WHERE id = 1 AND version = ?", string(state), now, req.BaseVersion)
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		current, err := s.loadState(r)
		if err != nil {
			serverError(w, err)
			return
		}
		writeJSON(w, http.StatusConflict, current)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"version": req.BaseVersion + 1})
}

func (s *server) listSessions(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), "SELECT data FROM sessions ORDER BY date DESC LIMIT 1000")
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	list := []json.RawMessage{}
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			serverError(w, err)
			return
		}
		list = append(list, json.RawMessage(data))
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": list})
}

// Idempotent upsert so a retried upload is harmless.
func (s *server) putSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !sessionID.MatchString(id) {
		writeError(w, http.StatusBadRequest, "bad session id")
		return
	}
	var raw json.RawMessage
	if !readJSON(w, r, &raw, 256<<10) {
		return
	}
	var meta struct {
		ID   string `json:"id"`
		Date string `json:"date"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil || meta.ID != id {
		writeError(w, http.StatusBadRequest, "session id must match the URL")
		return
	}
	date, err := time.Parse(time.RFC3339Nano, meta.Date)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad session date")
		return
	}
	_, err = s.db.ExecContext(r.Context(),
		"INSERT INTO sessions (id, date, data) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET date = excluded.date, data = excluded.data",
		id, date.UTC().Format(isoMillis), string(raw))
	if err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deleteSessions(w http.ResponseWriter, r *http.Request) {
	before, err := time.Parse(time.RFC3339Nano, r.URL.Query().Get("before"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "before must be an ISO date")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE date < ?", before.UTC().Format(isoMillis)); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Requiring a JSON content type blocks cross-site form posts.
func readJSON(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "expected application/json")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Print(err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func serverError(w http.ResponseWriter, err error) {
	log.Print(err)
	writeError(w, http.StatusInternalServerError, "internal error")
}
