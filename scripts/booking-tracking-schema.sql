CREATE TABLE IF NOT EXISTS booking_live_locations (
  booking_id INTEGER PRIMARY KEY REFERENCES customer_bookings(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  accuracy_m NUMERIC(10,2),
  observed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  sequence INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS booking_live_locations_provider ON booking_live_locations(provider_id);
