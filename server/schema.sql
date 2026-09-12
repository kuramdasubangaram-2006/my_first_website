CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_status TEXT NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending', 'granted', 'declined')),
  consent_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  ip_address_enc TEXT,
  ip_city_enc TEXT,
  ip_region_enc TEXT,
  ip_country_enc TEXT,
  ip_metadata_enc TEXT,
  latitude_enc TEXT,
  longitude_enc TEXT,
  browser TEXT,
  operating_system TEXT,
  device_type TEXT,
  screen_resolution TEXT,
  time_zone TEXT,
  language TEXT,
  referrer TEXT
);

CREATE INDEX IF NOT EXISTS tracking_sessions_created_at_idx ON tracking_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS tracking_sessions_consent_status_idx ON tracking_sessions (consent_status);
CREATE INDEX IF NOT EXISTS tracking_sessions_owner_id_idx ON tracking_sessions (owner_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  session_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);