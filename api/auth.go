package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"net"
	"net/http"
	"sync"
	"time"
)

const (
	cookieName = "nbt_session"
	tokenTTL   = 400 * 24 * time.Hour // browsers cap cookie lifetime at 400 days
)

// Counts events in a sliding window.
type limiter struct {
	max    int
	window time.Duration
	mu     sync.Mutex
	events []time.Time
}

func (l *limiter) allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := time.Now().Add(-l.window)
	kept := l.events[:0]
	for _, t := range l.events {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	l.events = kept
	return len(l.events) < l.max
}

func (l *limiter) record() {
	l.mu.Lock()
	l.events = append(l.events, time.Now())
	l.mu.Unlock()
}

// One limiter per client IP, so one visitor's wrong guesses don't lock out everyone.
type ipLimiter struct {
	max    int
	window time.Duration
	mu     sync.Mutex
	byIP   map[string]*limiter
}

func (l *ipLimiter) get(ip string) *limiter {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.byIP == nil || len(l.byIP) > 10000 {
		l.byIP = map[string]*limiter{}
	}
	lim := l.byIP[ip]
	if lim == nil {
		lim = &limiter{max: l.max, window: l.window}
		l.byIP[ip] = lim
	}
	return lim
}

// Fly's proxy sets Fly-Client-IP; elsewhere use the socket address.
func clientIP(r *http.Request) string {
	if ip := r.Header.Get("Fly-Client-IP"); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Passcode string `json:"passcode"`
	}
	if !readJSON(w, r, &req, 4<<10) {
		return
	}
	ipLim := s.ipLimits.get(clientIP(r))
	if !ipLim.allow() || !s.limits.allow() {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}
	sum := sha256.Sum256([]byte(req.Passcode))
	if subtle.ConstantTimeCompare(sum[:], s.passcode[:]) != 1 {
		ipLim.record()
		s.limits.record()
		writeError(w, http.StatusUnauthorized, "wrong passcode")
		return
	}

	b := make([]byte, 32)
	rand.Read(b)
	token := base64.RawURLEncoding.EncodeToString(b)
	if _, err := s.db.ExecContext(r.Context(), "INSERT INTO auth_tokens (hash, created_at) VALUES (?, ?)", hashToken(token), time.Now().Unix()); err != nil {
		serverError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(tokenTTL.Seconds()),
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteLaxMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		if _, err := s.db.ExecContext(r.Context(), "DELETE FROM auth_tokens WHERE hash = ?", hashToken(c.Value)); err != nil {
			serverError(w, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: isHTTPS(r), SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) auth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "sign in required")
			return
		}
		var n int
		err = s.db.QueryRowContext(r.Context(), "SELECT count(*) FROM auth_tokens WHERE hash = ? AND created_at > ?",
			hashToken(c.Value), time.Now().Add(-tokenTTL).Unix()).Scan(&n)
		if err != nil {
			serverError(w, err)
			return
		}
		if n == 0 {
			writeError(w, http.StatusUnauthorized, "sign in required")
			return
		}
		next(w, r)
	})
}
