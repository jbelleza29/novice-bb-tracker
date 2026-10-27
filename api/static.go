package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

// `make build` copies the Next.js static export into dist/.
//
//go:embed all:dist
var dist embed.FS

func staticHandler() http.Handler {
	sub, _ := fs.Sub(dist, "dist")
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Frontend not built. Run `make build`, or use the Next dev server on :3000.", http.StatusNotFound)
		})
	}
	files := http.FileServerFS(sub)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/_next/static/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}
