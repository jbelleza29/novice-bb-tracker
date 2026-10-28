package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	passcode := os.Getenv("NBT_PASSCODE")
	if passcode == "" {
		log.Fatal("NBT_PASSCODE must be set")
	}
	db, err := openDB(env("NBT_DB", "nbt.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	s := &server{
		db:       db,
		passcode: sha256.Sum256([]byte(passcode)),
		limits:   limiter{max: 10, window: 15 * time.Minute},
		est:      newEstimator(),
		ins:      newInsighter(),
	}
	if s.est != nil {
		log.Printf("meal estimates on, model %s", s.est.model)
	}
	if s.ins != nil {
		log.Printf("insights on, daily %s, weekly %s", s.ins.kinds["daily"].model, s.ins.kinds["weekly"].model)
	}
	srv := &http.Server{
		Addr:              env("NBT_ADDR", ":8080"),
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      100 * time.Second, // meal estimates can take a while
		IdleTimeout:       2 * time.Minute,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("listening on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()

	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil {
		log.Print(err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
