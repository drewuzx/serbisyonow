CREATE TABLE IF NOT EXISTS profile_photos (
 id BIGSERIAL PRIMARY KEY,
 customer_id INTEGER UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
 provider_id INTEGER UNIQUE REFERENCES providers(id) ON DELETE CASCADE,
 content BYTEA NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK ((customer_id IS NULL) <> (provider_id IS NULL))
);

CREATE TABLE IF NOT EXISTS provider_photo_reviews (
 provider_id INTEGER PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
 revision UUID NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined')),
 selfie BYTEA,
 id_front BYTEA,
 id_back BYTEA,
 reason TEXT NOT NULL DEFAULT '',
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 reviewed_at TIMESTAMPTZ,
 reviewed_by INTEGER,
 CHECK (status <> 'pending' OR (selfie IS NOT NULL AND id_front IS NOT NULL))
);
