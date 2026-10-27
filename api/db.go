package main

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS app_state (
	id         INTEGER PRIMARY KEY CHECK (id = 1),
	data       TEXT    NOT NULL,
	version    INTEGER NOT NULL,
	updated_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
	id   TEXT PRIMARY KEY,
	date TEXT NOT NULL,
	data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_date ON sessions (date);
CREATE TABLE IF NOT EXISTS auth_tokens (
	hash       TEXT    PRIMARY KEY,
	created_at INTEGER NOT NULL
);
`

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	// single user: one connection keeps writes serialised
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
