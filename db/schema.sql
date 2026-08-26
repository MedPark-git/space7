-- MedPark One PostgreSQL schema draft
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('active', 'terminated');
CREATE TYPE user_role AS ENUM ('basic', 'admin');
CREATE TYPE map_region AS ENUM ('domestic', 'overseas');
CREATE TYPE click_action AS ENUM ('show_data', 'redirect');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(30) UNIQUE NOT NULL,
  email varchar(255) UNIQUE,
  password_hash text NOT NULL,
  name varchar(100) NOT NULL,
  employee_no varchar(50) UNIQUE,
  department varchar(150),
  status user_status NOT NULL DEFAULT 'active',
  role user_role NOT NULL DEFAULT 'basic',
  terminated_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE portal_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES menus(id) ON DELETE CASCADE,
  title varchar(150) NOT NULL,
  link_url text,
  sort_order integer NOT NULL DEFAULT 0,
  icon varchar(100),
  is_external_link boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id uuid NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  can_view boolean NOT NULL DEFAULT true,
  can_edit boolean NOT NULL DEFAULT false,
  UNIQUE(menu_id, role)
);

CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id varchar(255) UNIQUE,
  source_account varchar(255) NOT NULL,
  title text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE map_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region map_region NOT NULL,
  title varchar(255) NOT NULL,
  latitude numeric(10,7),
  longitude numeric(10,7),
  source_url text,
  detail_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  click_action click_action NOT NULL DEFAULT 'show_data',
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meeting_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id varchar(255) UNIQUE,
  source varchar(50) NOT NULL DEFAULT 'plaud',
  title text NOT NULL,
  content text,
  meeting_at timestamptz,
  zapier_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(100) NOT NULL,
  target_type varchar(100),
  target_id varchar(255),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sso_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(100) NOT NULL,
  client_id varchar(255),
  issuer_url text,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_menus_parent_sort ON menus(parent_id, sort_order);
CREATE UNIQUE INDEX idx_users_username_lower ON users(lower(username));
CREATE INDEX idx_portal_sessions_expires ON portal_sessions(expires_at);
CREATE INDEX idx_calendar_events_start ON calendar_events(start_at);
CREATE INDEX idx_map_items_region ON map_items(region);
CREATE INDEX idx_meeting_notes_meeting_at ON meeting_notes(meeting_at DESC);
CREATE INDEX idx_audit_logs_actor_created ON audit_logs(actor_user_id, created_at DESC);
