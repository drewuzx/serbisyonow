CREATE TABLE IF NOT EXISTS platform_payment_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  wallet TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  qr_content BYTEA,
  qr_mime TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO platform_payment_settings(id) VALUES(1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS promotion_plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'promotion' CHECK (kind IN ('promotion','subscription')),
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  price_centavos INTEGER NOT NULL CHECK (price_centavos BETWEEN 0 AND 10000000),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT enabled OR price_centavos > 0)
);
INSERT INTO promotion_plans(name, description, duration_days, price_centavos)
SELECT '14-day Profile Boost', 'Priority placement in matching recommended search results for 14 days. Does not change verification badges or guarantee bookings.', 14, 0
WHERE NOT EXISTS (SELECT 1 FROM promotion_plans);

CREATE TABLE IF NOT EXISTS promotion_orders (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  plan_id INTEGER NOT NULL REFERENCES promotion_plans(id),
  request_id UUID NOT NULL UNIQUE,
  plan_name TEXT NOT NULL,
  description TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  amount_centavos INTEGER NOT NULL CHECK (amount_centavos > 0),
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment','awaiting_verification','rejected','paid','cancelled')),
  wallet TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  qr_content BYTEA NOT NULL,
  qr_mime TEXT NOT NULL,
  receipt_id INTEGER,
  reviewed_by INTEGER REFERENCES admins(id),
  paid_at TIMESTAMPTZ,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS promotion_one_open_order ON promotion_orders(provider_id)
WHERE status IN ('awaiting_payment','awaiting_verification','rejected');
CREATE INDEX IF NOT EXISTS promotion_active_boost ON promotion_orders(provider_id, expires_at) WHERE status='paid';

CREATE TABLE IF NOT EXISTS promotion_receipts (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES promotion_orders(id),
  reference_number TEXT NOT NULL,
  content BYTEA NOT NULL,
  mime_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','rejected','verified')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by INTEGER REFERENCES admins(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS promotion_references (
  reference_number TEXT PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES promotion_orders(id)
);

ALTER TABLE promotion_orders ADD COLUMN IF NOT EXISTS payment_channel TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE promotion_orders ADD COLUMN IF NOT EXISTS payment_livemode BOOLEAN;
ALTER TABLE promotion_orders ALTER COLUMN qr_content DROP NOT NULL;
ALTER TABLE promotion_orders ALTER COLUMN qr_mime DROP NOT NULL;
ALTER TABLE promotion_orders DROP CONSTRAINT IF EXISTS promotion_orders_status_check;
ALTER TABLE promotion_orders ADD CONSTRAINT promotion_orders_status_check CHECK
 (status IN ('awaiting_payment','awaiting_verification','rejected','paid','cancelled','test_paid','payment_review','refund_review'));
CREATE TABLE IF NOT EXISTS promotion_checkouts (
 order_id INTEGER PRIMARY KEY REFERENCES promotion_orders(id),
 reference_number TEXT NOT NULL UNIQUE,
 checkout_session_id TEXT UNIQUE,
 checkout_url TEXT,
 livemode BOOLEAN NOT NULL,
 status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','active','paid','expired','review')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS promotion_gateway_receipts (
 payment_id TEXT PRIMARY KEY,
 order_id INTEGER NOT NULL REFERENCES promotion_orders(id),
 amount_centavos INTEGER NOT NULL,
 livemode BOOLEAN NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('credited','test','refund_review')),
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
