-- D1 schema for the book recommendations app.
-- Same tables as the local SQLite version, with the columns that used to
-- be added via ALTER TABLE migrations folded directly into the CREATE TABLE.

CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_name_author TEXT NOT NULL,
  user_reason TEXT,
  fetched_title TEXT,
  fetched_authors TEXT,
  fetched_description TEXT,
  cover_url TEXT,
  submitted_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id INTEGER NOT NULL,
  voter_id TEXT NOT NULL,
  vote TEXT NOT NULL CHECK(vote IN ('interested', 'skip', 'not_interested')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (recommendation_id) REFERENCES recommendations(id),
  UNIQUE(recommendation_id, voter_id)
);
