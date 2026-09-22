-- Tally cloud sync: one vault per synced profile, one row per document.
CREATE TABLE vaults (
  id TEXT PRIMARY KEY,            -- hex SHA-256 of the normalized sync key
  created_at INTEGER NOT NULL     -- ms since epoch
);
CREATE TABLE docs (
  vault TEXT NOT NULL,
  path TEXT NOT NULL,             -- e.g. settings/main, foods/banana, templates/x, days/2026-09-21
  body TEXT,                      -- document JSON; NULL when deleted
  updated_at INTEGER NOT NULL,    -- ms since epoch, drives newest-wins
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,           -- per-vault change number, drives delta pulls
  PRIMARY KEY (vault, path)
);
CREATE INDEX docs_vault_seq ON docs (vault, seq);
