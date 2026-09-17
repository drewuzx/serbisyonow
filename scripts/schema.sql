CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  address TEXT NOT NULL,
  gender TEXT NOT NULL,
  contact TEXT NOT NULL,
  dob DATE NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  auth_provider TEXT NOT NULL DEFAULT 'password',
  google_sub TEXT,
  id_type TEXT,
  id_address TEXT,
  id_front_file TEXT,
  id_back_file TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  location_accuracy_m NUMERIC(10,2),
  location_updated_at TIMESTAMPTZ,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS providers (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  address TEXT NOT NULL,
  gender TEXT NOT NULL,
  contact TEXT NOT NULL,
  dob DATE NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  auth_provider TEXT NOT NULL DEFAULT 'password',
  google_sub TEXT,
  category TEXT NOT NULL,
  service TEXT NOT NULL,
  experience TEXT NOT NULL,
  experience_years TEXT NOT NULL,
  experience_certification TEXT NOT NULL,
  documents_files TEXT[] NOT NULL DEFAULT '{}',
  id_front_file TEXT,
  id_back_file TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  location_accuracy_m NUMERIC(10,2),
  location_updated_at TIMESTAMPTZ,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  services TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  account_type TEXT NOT NULL CHECK (account_type IN ('customer', 'provider')),
  account_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
  ON password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_account
  ON password_reset_tokens (account_type, account_id);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id SERIAL PRIMARY KEY,
  folder TEXT NOT NULL CHECK (folder IN ('customer-ids', 'provider-docs')),
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  content BYTEA NOT NULL,
  owner_role TEXT CHECK (owner_role IN ('customer', 'provider')),
  owner_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (folder, filename)
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_lookup
  ON uploaded_files (folder, filename);

CREATE TABLE IF NOT EXISTS admin_feedback (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'feedback'
    CHECK (type IN ('complaint', 'feedback')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  submitted_by TEXT NOT NULL DEFAULT 'User',
  related_party TEXT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'review', 'resolved', 'logged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_bookings (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  service TEXT NOT NULL,
  scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
  scheduled_time TEXT NOT NULL DEFAULT '09:00 AM',
  address TEXT NOT NULL DEFAULT '',
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  location_accuracy_m NUMERIC(10,2),
  location_updated_at TIMESTAMPTZ,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'upcoming', 'ongoing', 'completed', 'cancelled')),
  provider_closed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_feedback
  ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES customer_bookings(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS customer_messages (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  sender_role TEXT NOT NULL DEFAULT 'provider'
    CHECK (sender_role IN ('customer', 'provider')),
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_favorites (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, provider_id)
);

CREATE TABLE IF NOT EXISTS customer_reviews (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  booking_id INTEGER REFERENCES customer_bookings(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_services (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  starting_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  accepts_cash BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_gcash BOOLEAN NOT NULL DEFAULT FALSE,
  accepts_other BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_availability (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
  available_date DATE NOT NULL,
  start_time TEXT NOT NULL DEFAULT '09:00 AM',
  end_time TEXT NOT NULL DEFAULT '05:00 PM',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, available_date, start_time)
);

CREATE TABLE IF NOT EXISTS provider_skill_assessments (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  badge TEXT NOT NULL DEFAULT 'Basic Verified',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE providers
SET category = CASE
  WHEN category IN ('Home Repair') THEN 'Repair Services'
  WHEN category IN ('Home Installation', 'Home Installations') THEN 'Installation Services'
  WHEN category IN ('Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance') THEN 'Outdoor and Property Maintenance'
  ELSE category
END;

UPDATE provider_services
SET category = CASE
  WHEN category IN ('Home Repair') THEN 'Repair Services'
  WHEN category IN ('Home Installation', 'Home Installations') THEN 'Installation Services'
  WHEN category IN ('Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance') THEN 'Outdoor and Property Maintenance'
  ELSE category
END;

UPDATE provider_skill_assessments
SET category = CASE
  WHEN category IN ('Home Repair') THEN 'Repair Services'
  WHEN category IN ('Home Installation', 'Home Installations') THEN 'Installation Services'
  WHEN category IN ('Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance') THEN 'Outdoor and Property Maintenance'
  ELSE category
END;

DELETE FROM service_categories
WHERE name = 'Home Repair'
  AND EXISTS (SELECT 1 FROM service_categories WHERE name = 'Repair Services');
DELETE FROM service_categories
WHERE name = 'Home Installations'
  AND EXISTS (SELECT 1 FROM service_categories WHERE name IN ('Home Installation', 'Installation Services'));
DELETE FROM service_categories
WHERE name IN ('Home Installation', 'Home Installations')
  AND EXISTS (SELECT 1 FROM service_categories WHERE name = 'Installation Services');
DELETE FROM service_categories
WHERE name IN ('Outdoor & Property', 'Outdoor Maintenance')
  AND EXISTS (SELECT 1 FROM service_categories WHERE name IN ('Outdoor & Property Maintenance', 'Outdoor and Property Maintenance'));
DELETE FROM service_categories
WHERE name = 'Outdoor Maintenance'
  AND EXISTS (SELECT 1 FROM service_categories WHERE name = 'Outdoor & Property');
DELETE FROM service_categories
WHERE name IN ('Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance')
  AND EXISTS (SELECT 1 FROM service_categories WHERE name = 'Outdoor and Property Maintenance');

UPDATE service_categories
SET name = 'Repair Services'
WHERE name = 'Home Repair';
UPDATE service_categories
SET name = 'Installation Services'
WHERE name IN ('Home Installation', 'Home Installations');
UPDATE service_categories
SET name = 'Outdoor and Property Maintenance'
WHERE name IN ('Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance');

INSERT INTO service_categories (name, description, services)
VALUES
  ('Repair Services', 'Services related to fixing or maintaining household facilities.', ARRAY['Plumbing services','Electrical repair','Appliance repair','Carpentry','Roof repair','Furniture repair','Painting services','Door and window repair']),
  ('Cleaning', 'Services focused on cleaning and sanitation of homes.', ARRAY['General house cleaning','Deep cleaning','Bathroom cleaning','Kitchen cleaning','Sofa and upholstery cleaning','Carpet cleaning','Window cleaning','Laundry Services']),
  ('Personal Care', 'Services related to health, relaxation, and personal care.', ARRAY['Massage therapy','Home spa services','Haircut','Nail Care','Eyelash Care','Grooming']),
  ('Appliance Maintenance', 'Services focused on maintaining household appliances.', ARRAY['Aircon','Refrigerator','Washing Machine','Microwave','TV / Electronics','Small Appliances']),
  ('Installation Services', 'Services that improve or upgrade household facilities.', ARRAY['Furniture assembly','Cabinet installation','Curtain or blinds installation','Lighting installation','CCTV installation','Internet or router setup','Appliance Installation']),
  ('Outdoor and Property Maintenance', 'Services related to the maintenance of outdoor spaces.', ARRAY['Gardening services','Lawn mowing','Landscape maintenance','Tree trimming','Fence repair'])
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description,
    services = EXCLUDED.services,
    is_active = TRUE,
    updated_at = NOW();
