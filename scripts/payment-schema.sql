CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash TEXT PRIMARY KEY,
  account_role TEXT NOT NULL CHECK (account_role IN ('customer', 'provider')),
  account_id INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions (expires_at);

-- Existing bookings keep their original payment agreement.
ALTER TABLE customer_bookings
  ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS confirmed_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS price_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS price_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_agreed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS balance_due NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_livemode BOOLEAN;

CREATE TABLE IF NOT EXISTS booking_payments (
  id BIGSERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES customer_bookings(id) ON DELETE RESTRICT,
  reference_number TEXT UNIQUE,
  checkout_session_id TEXT UNIQUE,
  checkout_url TEXT,
  amount_centavos BIGINT NOT NULL CHECK (amount_centavos > 0),
  currency TEXT NOT NULL DEFAULT 'PHP' CHECK (currency = 'PHP'),
  livemode BOOLEAN NOT NULL,
  price_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'active', 'paid', 'expire_pending', 'expired', 'refund_review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_payment_receipts (
  payment_id TEXT PRIMARY KEY,
  checkout_id BIGINT NOT NULL REFERENCES booking_payments(id) ON DELETE RESTRICT,
  amount_centavos BIGINT NOT NULL CHECK (amount_centavos > 0),
  currency TEXT NOT NULL CHECK (currency = 'PHP'),
  livemode BOOLEAN NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('credited', 'refund_review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
