PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    visited_at TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    browser TEXT NOT NULL,
    operating_system TEXT NOT NULL,
    device_type TEXT NOT NULL,
    ip_intelligence TEXT NOT NULL DEFAULT '{}',
    screen_resolution TEXT,
    language TEXT,
    timezone TEXT,
    referrer TEXT,
    capabilities TEXT
);

CREATE TABLE IF NOT EXISTS consent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    event_at TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('gps', 'camera')),
    payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visits_link_id ON visits(link_id);
CREATE INDEX IF NOT EXISTS idx_visits_visited_at ON visits(visited_at);
