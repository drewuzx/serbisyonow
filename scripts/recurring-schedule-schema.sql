CREATE TABLE IF NOT EXISTS provider_schedule_repeats (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  weekdays INTEGER[] NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS provider_schedule_repeats_active
  ON provider_schedule_repeats(provider_id) WHERE is_active;

ALTER TABLE provider_availability ADD COLUMN IF NOT EXISTS repeat_id INTEGER
  REFERENCES provider_schedule_repeats(id) ON DELETE SET NULL;

-- Keep an occurrence record after deletion or conflict so it cannot reopen later.
CREATE TABLE IF NOT EXISTS provider_schedule_occurrences (
  repeat_id INTEGER NOT NULL REFERENCES provider_schedule_repeats(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  PRIMARY KEY(repeat_id, occurrence_date)
);
