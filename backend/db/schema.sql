CREATE TABLE IF NOT EXISTS inbound (
  id text PRIMARY KEY,
  message_id text UNIQUE,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversations (
  handle text PRIMARY KEY,
  space_id text NOT NULL,
  agent_id text NOT NULL,
  photon_project text,
  active_order bigint,
  pending jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS photon_project text;
CREATE TABLE IF NOT EXISTS work_orders (
  id bigserial PRIMARY KEY,
  property_id text NOT NULL,
  zone_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'scheduled', 'awaiting_confirmation', 'closed')),
  access_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  visit_start timestamptz,
  visit_end timestamptz,
  next_nudge_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_order_lookup ON work_orders (property_id, zone_id, created_at);
CREATE TABLE IF NOT EXISTS repair_contexts (
  order_id bigint PRIMARY KEY REFERENCES work_orders (id) ON DELETE CASCADE,
  address text NOT NULL,
  property_match boolean NOT NULL,
  issue text NOT NULL CHECK (issue IN ('leak', 'damage')),
  aid text NOT NULL CONSTRAINT repair_contexts_aid_valid CHECK (aid IN ('bucket', 'towel', 'clear', 'stair-sign')),
  area jsonb,
  updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS blender_renders (
  order_id bigint PRIMARY KEY REFERENCES work_orders (id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (subject IN ('lobby', 'warehouse', 'inspection')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ready', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  image bytea
);
ALTER TABLE blender_renders ADD COLUMN IF NOT EXISTS aid text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='repair_contexts'::regclass AND conname='repair_contexts_aid_valid') THEN
    ALTER TABLE repair_contexts DROP CONSTRAINT IF EXISTS repair_contexts_aid_check;
    ALTER TABLE repair_contexts ADD CONSTRAINT repair_contexts_aid_valid CHECK (aid IN ('bucket', 'towel', 'clear', 'stair-sign'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='blender_renders'::regclass AND conname='blender_renders_aid_valid') THEN
    ALTER TABLE blender_renders DROP CONSTRAINT IF EXISTS blender_renders_aid_check;
    ALTER TABLE blender_renders ADD CONSTRAINT blender_renders_aid_valid CHECK (aid IN ('bucket', 'towel', 'clear', 'stair-sign'));
  END IF;
END
$$;
CREATE TABLE IF NOT EXISTS reports (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES work_orders (id),
  message_id text NOT NULL UNIQUE,
  reporter text NOT NULL,
  landmark_id text NOT NULL,
  description text NOT NULL,
  photo bytea,
  photo_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE reports ADD COLUMN IF NOT EXISTS area_notice_pending boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS work_order_events (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES work_orders (id),
  action text NOT NULL,
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target text NOT NULL,
  body text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued',
  photon_message_id text UNIQUE,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS render_order_id bigint REFERENCES work_orders (id) ON DELETE CASCADE;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS is_render boolean NOT NULL DEFAULT false;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS photo_report_id bigint REFERENCES reports (id) ON DELETE CASCADE;
