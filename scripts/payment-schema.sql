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

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS payment_qr_file TEXT,
  ADD COLUMN IF NOT EXISTS payment_account_name TEXT,
  ADD COLUMN IF NOT EXISTS payment_account_number TEXT,
  ADD COLUMN IF NOT EXISTS payment_wallet TEXT;

ALTER TABLE uploaded_files DROP CONSTRAINT IF EXISTS uploaded_files_folder_check;
ALTER TABLE uploaded_files ADD CONSTRAINT uploaded_files_folder_check
  CHECK (folder IN ('customer-ids', 'provider-docs', 'booking-media', 'provider-payment-qrs'));

-- Do not change the recipient of an already-started gateway payment.
ALTER TABLE customer_bookings
  ADD COLUMN IF NOT EXISTS deposit_channel TEXT NOT NULL DEFAULT 'paymongo',
  ADD COLUMN IF NOT EXISTS payment_qr_file TEXT,
  ADD COLUMN IF NOT EXISTS payment_account_name TEXT,
  ADD COLUMN IF NOT EXISTS payment_account_number TEXT,
  ADD COLUMN IF NOT EXISTS payment_wallet TEXT,
  ADD COLUMN IF NOT EXISTS deposit_receipt_id BIGINT;
ALTER TABLE customer_bookings ALTER COLUMN deposit_channel SET DEFAULT 'provider_qr';
UPDATE customer_bookings b SET deposit_channel = 'provider_qr'
WHERE b.deposit_channel = 'paymongo' AND b.deposit_required AND b.status = 'pending' AND b.customer_agreed_at IS NULL
  AND b.deposit_status IN ('awaiting_price', 'awaiting_payment')
  AND NOT EXISTS (SELECT 1 FROM booking_payments p WHERE p.booking_id = b.id);

CREATE TABLE IF NOT EXISTS provider_direct_payment_receipts (
  id BIGSERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES customer_bookings(id) ON DELETE RESTRICT,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  reference_number TEXT NOT NULL,
  amount_centavos BIGINT NOT NULL CHECK (amount_centavos > 0),
  price_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected', 'refund_review')),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  content BYTEA NOT NULL,
  review_note TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_direct_receipt_reference
  ON provider_direct_payment_receipts (provider_id, reference_number)
  WHERE status <> 'rejected';
CREATE INDEX IF NOT EXISTS provider_direct_receipt_booking
  ON provider_direct_payment_receipts (booking_id);
