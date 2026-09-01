-- LifeHub – Serverschema für die Synchronisation
-- Erzeugt aus src/db/schema.ts. Nicht von Hand bearbeiten, sondern neu erzeugen:
--   node scripts/gen-supabase-sql.mjs > supabase/migrations/0001_init.sql

-- Eine einzige globale Sequenz vergibt server_rev. Der Client fragt
-- "gib mir alles mit server_rev > mein Cursor" – dadurch kann strukturell
-- keine Änderung übersprungen werden. Zeitstempel wären dafür unbrauchbar,
-- weil Geräteuhren falsch gehen.
CREATE SEQUENCE IF NOT EXISTS server_rev_seq;

CREATE OR REPLACE FUNCTION set_server_rev() RETURNS trigger AS $$
BEGIN
  NEW.server_rev := nextval('server_rev_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TABLE IF NOT EXISTS settings (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, key text NOT NULL, value_json text NOT NULL,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS devices (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, name text NOT NULL, platform text NOT NULL,
      last_sync_at text, app_version text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS tags (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, name text NOT NULL, color text, scope text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS taggables (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, tag_id text NOT NULL,
      entity_type text NOT NULL, entity_id text NOT NULL,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS links (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY,
      from_type text NOT NULL, from_id text NOT NULL,
      to_type text NOT NULL, to_id text NOT NULL,
      relation text NOT NULL,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS attachments (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY,
      entity_type text NOT NULL, entity_id text NOT NULL,
      filename text NOT NULL, mime_type text NOT NULL, size_bytes integer NOT NULL,
      sha256 text NOT NULL, data_url text, remote_path text,
      upload_state text NOT NULL DEFAULT 'pending',
      width integer, height integer, taken_at text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS import_batches (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, source text NOT NULL, filename text,
      mapping_json text NOT NULL, row_count integer NOT NULL,
      skipped_count integer NOT NULL DEFAULT 0,
      imported_at text NOT NULL, undone_at text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS accounts (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, name text NOT NULL, type text NOT NULL,
      currency text NOT NULL DEFAULT 'EUR',
      opening_balance_cents integer NOT NULL DEFAULT 0,
      opening_date text NOT NULL,
      iban text, institution text, color text, icon text,
      is_active integer NOT NULL DEFAULT 1,
      counts_as_savings integer NOT NULL DEFAULT 0,
      counts_as_available integer NOT NULL DEFAULT 1,
      include_in_net_worth integer NOT NULL DEFAULT 1,
      sort_order integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS categories (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, name text NOT NULL, parent_id text,
      kind text NOT NULL, color text, icon text,
      is_archived integer NOT NULL DEFAULT 0,
      is_system integer NOT NULL DEFAULT 0,
      exclude_from_stats integer NOT NULL DEFAULT 0,
      sort_order integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS transactions (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, type text NOT NULL,
      booked_on text NOT NULL, value_on text,
      amount_cents integer NOT NULL, currency text NOT NULL DEFAULT 'EUR',
      account_id text NOT NULL, to_account_id text, category_id text,
      merchant text, description text, note text,
      status text NOT NULL DEFAULT 'booked',
      recurring_id text, import_batch_id text, external_ref text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE INDEX IF NOT EXISTS ix_tx_date ON transactions(user_id, booked_on);

CREATE INDEX IF NOT EXISTS ix_tx_account ON transactions(user_id, account_id);

CREATE INDEX IF NOT EXISTS ix_tx_category ON transactions(user_id, category_id);

CREATE TABLE IF NOT EXISTS budgets (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, category_id text,
      period text NOT NULL DEFAULT 'monthly',
      amount_cents integer NOT NULL,
      valid_from text NOT NULL, valid_to text,
      warn_at_percent integer NOT NULL DEFAULT 80,
      rollover integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS recurring_rules (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, kind text NOT NULL, title text NOT NULL,
      rrule text NOT NULL, starts_on text NOT NULL, ends_on text,
      template_json text NOT NULL,
      auto_book integer NOT NULL DEFAULT 0,
      lead_days integer NOT NULL DEFAULT 5,
      last_generated_on text, is_active integer NOT NULL DEFAULT 1,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS monthly_closings (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, year_month text NOT NULL,
      closed_at text, snapshot_json text NOT NULL,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS finance_day_runs (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, ran_on text NOT NULL,
      checklist_json text NOT NULL, completed_at text, note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS projects (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, name text NOT NULL, description text,
      color text, status text NOT NULL DEFAULT 'active', due_on text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS tasks (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, title text NOT NULL, description text, note text,
      status text NOT NULL DEFAULT 'open',
      bucket text NOT NULL DEFAULT 'inbox',
      scheduled_on text, scheduled_time text,
      due_on text, due_time text,
      duration_minutes integer, priority integer NOT NULL DEFAULT 2,
      category text, project_id text, parent_task_id text, recurring_id text,
      completed_at text, energy text,
      sort_order integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE INDEX IF NOT EXISTS ix_task_sched ON tasks(user_id, scheduled_on);

CREATE TABLE IF NOT EXISTS time_blocks (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, day text NOT NULL,
      start_time text NOT NULL, end_time text NOT NULL,
      kind text NOT NULL, title text NOT NULL, color text,
      task_id text, event_id text,
      is_locked integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS calendar_events (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, title text NOT NULL, description text, location text,
      day text NOT NULL, start_time text, end_time text,
      all_day integer NOT NULL DEFAULT 0,
      timezone text NOT NULL DEFAULT 'Europe/Berlin',
      rrule text, exdates text, color text,
      source text NOT NULL DEFAULT 'local', external_uid text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE INDEX IF NOT EXISTS ix_event_day ON calendar_events(user_id, day);

CREATE TABLE IF NOT EXISTS day_types (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, name text NOT NULL, short_code text NOT NULL,
      kind text NOT NULL, default_start text, default_end text,
      break_minutes integer NOT NULL DEFAULT 0, color text,
      counts_as_workday integer NOT NULL DEFAULT 1,
      sort_order integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS day_assignments (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, day text NOT NULL, day_type_id text NOT NULL,
      start_override text, end_override text, note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE INDEX IF NOT EXISTS ux_day_assign ON day_assignments(user_id, day);

CREATE TABLE IF NOT EXISTS shift_patterns (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, name text NOT NULL, cycle_days integer NOT NULL,
      pattern_json text NOT NULL, anchor_date text NOT NULL,
      active_from text NOT NULL, active_to text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS holidays (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, day text NOT NULL, name text NOT NULL,
      region text NOT NULL, is_public integer NOT NULL DEFAULT 1,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS metrics (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, key text NOT NULL, name text NOT NULL,
      group_key text NOT NULL, unit text NOT NULL, value_type text NOT NULL,
      decimals integer NOT NULL DEFAULT 1,
      scale_min double precision, scale_max double precision, scale_labels_json text,
      aggregation text NOT NULL DEFAULT 'last',
      direction text NOT NULL DEFAULT 'neutral',
      is_builtin integer NOT NULL DEFAULT 0,
      is_enabled integer NOT NULL DEFAULT 1,
      show_in_daily_form integer NOT NULL DEFAULT 1,
      color text, sort_order integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS metric_entries (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, metric_id text NOT NULL, day text NOT NULL,
      at_time text, value_num double precision, value_text text, note text,
      source text NOT NULL DEFAULT 'manual', import_batch_id text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE INDEX IF NOT EXISTS ix_me_metric_day ON metric_entries(user_id, metric_id, day);

CREATE TABLE IF NOT EXISTS metric_targets (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, metric_id text NOT NULL,
      target_value double precision, tolerance_minus double precision, tolerance_plus double precision,
      hard_min double precision, hard_max double precision,
      period text NOT NULL DEFAULT 'daily',
      valid_from text NOT NULL, valid_to text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS exercises (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, name text NOT NULL, category text, muscle_groups text,
      tracks_weight integer NOT NULL DEFAULT 1,
      tracks_reps integer NOT NULL DEFAULT 1,
      tracks_time integer NOT NULL DEFAULT 0,
      is_bodyweight integer NOT NULL DEFAULT 0, note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS workout_plans (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, name text NOT NULL,
      cycle_weeks integer NOT NULL DEFAULT 2, anchor_date text NOT NULL,
      is_active integer NOT NULL DEFAULT 1,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS workout_plan_days (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, plan_id text NOT NULL,
      week_index integer NOT NULL, weekday integer NOT NULL,
      frequency text NOT NULL DEFAULT 'every',
      title text NOT NULL, focus text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS workout_plan_exercises (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, plan_day_id text NOT NULL, exercise_id text NOT NULL,
      target_sets integer, target_reps text, target_weight_kg double precision,
      rest_seconds integer, sort_order integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, day text NOT NULL, plan_day_id text,
      title text NOT NULL, type text,
      started_at text, ended_at text, duration_minutes integer,
      status text NOT NULL DEFAULT 'planned',
      perceived_effort integer, note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS workout_sets (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, session_id text NOT NULL, exercise_id text NOT NULL,
      set_index integer NOT NULL, reps integer, weight_kg double precision,
      seconds integer, distance_m double precision,
      is_warmup integer NOT NULL DEFAULT 0, note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS body_measurements (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, day text NOT NULL,
      weight_kg double precision, waist_cm double precision, chest_cm double precision, upper_arm_cm double precision,
      shoulder_cm double precision, thigh_cm double precision, neck_cm double precision,
      body_fat_percent double precision, method text, note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS progress_photos (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, day text NOT NULL, pose text NOT NULL,
      attachment_id text NOT NULL, weight_kg double precision, note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS goals (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, name text NOT NULL, description text,
      domain text NOT NULL, goal_kind text NOT NULL,
      target_account_id text, metric_id text, manual_current double precision,
      start_value double precision, target_value double precision,
      start_on text NOT NULL, target_on text,
      status text NOT NULL DEFAULT 'active', color text, icon text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS goal_contributions (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, goal_id text NOT NULL, day text NOT NULL,
      amount double precision NOT NULL, transaction_id text, note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS notes (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, title text, body text NOT NULL, day text,
      pinned integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS notifications (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, kind text NOT NULL, title text NOT NULL, body text,
      scheduled_for text NOT NULL, delivered_at text, dismissed_at text,
      entity_type text, entity_id text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS insights (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, kind text NOT NULL, severity text NOT NULL,
      title text NOT NULL, body text NOT NULL, evidence_json text NOT NULL,
      period_start text, period_end text,
      is_statistical integer NOT NULL DEFAULT 0, dismissed_at text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS task_templates (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY,
      title text NOT NULL,
      description text,
      duration_minutes integer,
      priority integer NOT NULL DEFAULT 2,
      weekday integer,
      day_type_id text,
      interval_weeks integer NOT NULL DEFAULT 1,
      anchor_date text,
      is_active integer NOT NULL DEFAULT 1,
      last_generated_on text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS account_checks (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY,
      account_id text NOT NULL,
      day text NOT NULL,
      expected_cents integer NOT NULL,
      actual_cents integer NOT NULL,
      correction_id text,
      note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS shopping_items (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY,
      name text NOT NULL,
      quantity text,
      aisle text,
      note text,
      is_checked integer NOT NULL DEFAULT 0,
      checked_at text,
      is_template integer NOT NULL DEFAULT 0,
      times_used integer NOT NULL DEFAULT 0,
      estimated_cents integer,
      sort_order integer NOT NULL DEFAULT 0,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE INDEX IF NOT EXISTS ix_shopping_open ON shopping_items(user_id, is_checked);

CREATE INDEX IF NOT EXISTS ix_task_due ON tasks(user_id, due_on);

CREATE TABLE IF NOT EXISTS day_notes (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY, day text NOT NULL, note text NOT NULL,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE INDEX IF NOT EXISTS ux_day_notes ON day_notes(user_id, day);

CREATE TABLE IF NOT EXISTS investments (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY,
      name text NOT NULL,
      note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE TABLE IF NOT EXISTS investment_moves (
  user_id uuid NOT NULL DEFAULT auth.uid(),
      id text PRIMARY KEY,
      investment_id text NOT NULL,
      day text NOT NULL,
      kind text NOT NULL,
      amount_cents integer NOT NULL,
      cost_basis_cents integer,
      note text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  deleted_at     text,
  version        integer NOT NULL DEFAULT 1,
  last_device_id text NOT NULL DEFAULT '',
  server_rev bigint
);

CREATE INDEX IF NOT EXISTS ix_investment_moves_investment ON investment_moves(user_id, investment_id);

-- Spalten aus späteren Migrationen

ALTER TABLE goals ADD COLUMN IF NOT EXISTS progress_percent double precision;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS completed_on text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS template_id text;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS show_zone integer NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS show_from text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pinned_day integer NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS carried_count integer NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS carried_from text;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS end_day text;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS reminder_minutes integer;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_end_on text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress_total integer;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress_done integer;


-- server_rev: Sequenz, Index und Trigger je Tabelle

ALTER TABLE settings ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_settings_rev ON settings(server_rev);
DROP TRIGGER IF EXISTS trg_settings_rev ON settings;
CREATE TRIGGER trg_settings_rev BEFORE INSERT OR UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE devices ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_devices_rev ON devices(server_rev);
DROP TRIGGER IF EXISTS trg_devices_rev ON devices;
CREATE TRIGGER trg_devices_rev BEFORE INSERT OR UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE tags ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_tags_rev ON tags(server_rev);
DROP TRIGGER IF EXISTS trg_tags_rev ON tags;
CREATE TRIGGER trg_tags_rev BEFORE INSERT OR UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE taggables ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_taggables_rev ON taggables(server_rev);
DROP TRIGGER IF EXISTS trg_taggables_rev ON taggables;
CREATE TRIGGER trg_taggables_rev BEFORE INSERT OR UPDATE ON taggables
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE links ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_links_rev ON links(server_rev);
DROP TRIGGER IF EXISTS trg_links_rev ON links;
CREATE TRIGGER trg_links_rev BEFORE INSERT OR UPDATE ON links
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE attachments ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_attachments_rev ON attachments(server_rev);
DROP TRIGGER IF EXISTS trg_attachments_rev ON attachments;
CREATE TRIGGER trg_attachments_rev BEFORE INSERT OR UPDATE ON attachments
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE import_batches ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_import_batches_rev ON import_batches(server_rev);
DROP TRIGGER IF EXISTS trg_import_batches_rev ON import_batches;
CREATE TRIGGER trg_import_batches_rev BEFORE INSERT OR UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE accounts ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_accounts_rev ON accounts(server_rev);
DROP TRIGGER IF EXISTS trg_accounts_rev ON accounts;
CREATE TRIGGER trg_accounts_rev BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE categories ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_categories_rev ON categories(server_rev);
DROP TRIGGER IF EXISTS trg_categories_rev ON categories;
CREATE TRIGGER trg_categories_rev BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE transactions ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_transactions_rev ON transactions(server_rev);
DROP TRIGGER IF EXISTS trg_transactions_rev ON transactions;
CREATE TRIGGER trg_transactions_rev BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE budgets ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_budgets_rev ON budgets(server_rev);
DROP TRIGGER IF EXISTS trg_budgets_rev ON budgets;
CREATE TRIGGER trg_budgets_rev BEFORE INSERT OR UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE recurring_rules ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_recurring_rules_rev ON recurring_rules(server_rev);
DROP TRIGGER IF EXISTS trg_recurring_rules_rev ON recurring_rules;
CREATE TRIGGER trg_recurring_rules_rev BEFORE INSERT OR UPDATE ON recurring_rules
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE monthly_closings ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_monthly_closings_rev ON monthly_closings(server_rev);
DROP TRIGGER IF EXISTS trg_monthly_closings_rev ON monthly_closings;
CREATE TRIGGER trg_monthly_closings_rev BEFORE INSERT OR UPDATE ON monthly_closings
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE finance_day_runs ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_finance_day_runs_rev ON finance_day_runs(server_rev);
DROP TRIGGER IF EXISTS trg_finance_day_runs_rev ON finance_day_runs;
CREATE TRIGGER trg_finance_day_runs_rev BEFORE INSERT OR UPDATE ON finance_day_runs
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE projects ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_projects_rev ON projects(server_rev);
DROP TRIGGER IF EXISTS trg_projects_rev ON projects;
CREATE TRIGGER trg_projects_rev BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE tasks ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_tasks_rev ON tasks(server_rev);
DROP TRIGGER IF EXISTS trg_tasks_rev ON tasks;
CREATE TRIGGER trg_tasks_rev BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE time_blocks ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_time_blocks_rev ON time_blocks(server_rev);
DROP TRIGGER IF EXISTS trg_time_blocks_rev ON time_blocks;
CREATE TRIGGER trg_time_blocks_rev BEFORE INSERT OR UPDATE ON time_blocks
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE calendar_events ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_calendar_events_rev ON calendar_events(server_rev);
DROP TRIGGER IF EXISTS trg_calendar_events_rev ON calendar_events;
CREATE TRIGGER trg_calendar_events_rev BEFORE INSERT OR UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE day_types ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_day_types_rev ON day_types(server_rev);
DROP TRIGGER IF EXISTS trg_day_types_rev ON day_types;
CREATE TRIGGER trg_day_types_rev BEFORE INSERT OR UPDATE ON day_types
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE day_assignments ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_day_assignments_rev ON day_assignments(server_rev);
DROP TRIGGER IF EXISTS trg_day_assignments_rev ON day_assignments;
CREATE TRIGGER trg_day_assignments_rev BEFORE INSERT OR UPDATE ON day_assignments
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE shift_patterns ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_shift_patterns_rev ON shift_patterns(server_rev);
DROP TRIGGER IF EXISTS trg_shift_patterns_rev ON shift_patterns;
CREATE TRIGGER trg_shift_patterns_rev BEFORE INSERT OR UPDATE ON shift_patterns
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE holidays ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_holidays_rev ON holidays(server_rev);
DROP TRIGGER IF EXISTS trg_holidays_rev ON holidays;
CREATE TRIGGER trg_holidays_rev BEFORE INSERT OR UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE metrics ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_metrics_rev ON metrics(server_rev);
DROP TRIGGER IF EXISTS trg_metrics_rev ON metrics;
CREATE TRIGGER trg_metrics_rev BEFORE INSERT OR UPDATE ON metrics
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE metric_entries ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_metric_entries_rev ON metric_entries(server_rev);
DROP TRIGGER IF EXISTS trg_metric_entries_rev ON metric_entries;
CREATE TRIGGER trg_metric_entries_rev BEFORE INSERT OR UPDATE ON metric_entries
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE metric_targets ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_metric_targets_rev ON metric_targets(server_rev);
DROP TRIGGER IF EXISTS trg_metric_targets_rev ON metric_targets;
CREATE TRIGGER trg_metric_targets_rev BEFORE INSERT OR UPDATE ON metric_targets
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE exercises ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_exercises_rev ON exercises(server_rev);
DROP TRIGGER IF EXISTS trg_exercises_rev ON exercises;
CREATE TRIGGER trg_exercises_rev BEFORE INSERT OR UPDATE ON exercises
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE workout_plans ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_workout_plans_rev ON workout_plans(server_rev);
DROP TRIGGER IF EXISTS trg_workout_plans_rev ON workout_plans;
CREATE TRIGGER trg_workout_plans_rev BEFORE INSERT OR UPDATE ON workout_plans
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE workout_plan_days ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_workout_plan_days_rev ON workout_plan_days(server_rev);
DROP TRIGGER IF EXISTS trg_workout_plan_days_rev ON workout_plan_days;
CREATE TRIGGER trg_workout_plan_days_rev BEFORE INSERT OR UPDATE ON workout_plan_days
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE workout_plan_exercises ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_workout_plan_exercises_rev ON workout_plan_exercises(server_rev);
DROP TRIGGER IF EXISTS trg_workout_plan_exercises_rev ON workout_plan_exercises;
CREATE TRIGGER trg_workout_plan_exercises_rev BEFORE INSERT OR UPDATE ON workout_plan_exercises
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE workout_sessions ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_workout_sessions_rev ON workout_sessions(server_rev);
DROP TRIGGER IF EXISTS trg_workout_sessions_rev ON workout_sessions;
CREATE TRIGGER trg_workout_sessions_rev BEFORE INSERT OR UPDATE ON workout_sessions
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE workout_sets ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_workout_sets_rev ON workout_sets(server_rev);
DROP TRIGGER IF EXISTS trg_workout_sets_rev ON workout_sets;
CREATE TRIGGER trg_workout_sets_rev BEFORE INSERT OR UPDATE ON workout_sets
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE body_measurements ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_body_measurements_rev ON body_measurements(server_rev);
DROP TRIGGER IF EXISTS trg_body_measurements_rev ON body_measurements;
CREATE TRIGGER trg_body_measurements_rev BEFORE INSERT OR UPDATE ON body_measurements
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE progress_photos ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_progress_photos_rev ON progress_photos(server_rev);
DROP TRIGGER IF EXISTS trg_progress_photos_rev ON progress_photos;
CREATE TRIGGER trg_progress_photos_rev BEFORE INSERT OR UPDATE ON progress_photos
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE goals ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_goals_rev ON goals(server_rev);
DROP TRIGGER IF EXISTS trg_goals_rev ON goals;
CREATE TRIGGER trg_goals_rev BEFORE INSERT OR UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE goal_contributions ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_goal_contributions_rev ON goal_contributions(server_rev);
DROP TRIGGER IF EXISTS trg_goal_contributions_rev ON goal_contributions;
CREATE TRIGGER trg_goal_contributions_rev BEFORE INSERT OR UPDATE ON goal_contributions
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE notes ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_notes_rev ON notes(server_rev);
DROP TRIGGER IF EXISTS trg_notes_rev ON notes;
CREATE TRIGGER trg_notes_rev BEFORE INSERT OR UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE notifications ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_notifications_rev ON notifications(server_rev);
DROP TRIGGER IF EXISTS trg_notifications_rev ON notifications;
CREATE TRIGGER trg_notifications_rev BEFORE INSERT OR UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE insights ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_insights_rev ON insights(server_rev);
DROP TRIGGER IF EXISTS trg_insights_rev ON insights;
CREATE TRIGGER trg_insights_rev BEFORE INSERT OR UPDATE ON insights
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE task_templates ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_task_templates_rev ON task_templates(server_rev);
DROP TRIGGER IF EXISTS trg_task_templates_rev ON task_templates;
CREATE TRIGGER trg_task_templates_rev BEFORE INSERT OR UPDATE ON task_templates
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE account_checks ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_account_checks_rev ON account_checks(server_rev);
DROP TRIGGER IF EXISTS trg_account_checks_rev ON account_checks;
CREATE TRIGGER trg_account_checks_rev BEFORE INSERT OR UPDATE ON account_checks
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE shopping_items ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_shopping_items_rev ON shopping_items(server_rev);
DROP TRIGGER IF EXISTS trg_shopping_items_rev ON shopping_items;
CREATE TRIGGER trg_shopping_items_rev BEFORE INSERT OR UPDATE ON shopping_items
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE day_notes ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_day_notes_rev ON day_notes(server_rev);
DROP TRIGGER IF EXISTS trg_day_notes_rev ON day_notes;
CREATE TRIGGER trg_day_notes_rev BEFORE INSERT OR UPDATE ON day_notes
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE investments ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_investments_rev ON investments(server_rev);
DROP TRIGGER IF EXISTS trg_investments_rev ON investments;
CREATE TRIGGER trg_investments_rev BEFORE INSERT OR UPDATE ON investments
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();

ALTER TABLE investment_moves ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_investment_moves_rev ON investment_moves(server_rev);
DROP TRIGGER IF EXISTS trg_investment_moves_rev ON investment_moves;
CREATE TRIGGER trg_investment_moves_rev BEFORE INSERT OR UPDATE ON investment_moves
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();


-- Rechte: Nur angemeldete Personen dürfen überhaupt zugreifen. Der öffentliche
-- Schlüssel allein (Rolle "anon") bekommt bewusst nichts – er dient nur dazu,
-- das Projekt zu benennen.
--
-- Der Entzug für "anon" ist Absicht und kein Übereifer: Supabase vergibt für
-- neue Tabellen im Schema "public" von Haus aus Rechte an anon. Die
-- Zeilensicherheit fängt das zwar ab (ohne Anmeldung ist auth.uid() leer und
-- es passt keine Zeile), aber dann hinge alles an einer einzigen Regel. Ohne
-- Tabellenrecht kommt anon gar nicht erst so weit – zwei Schlösser statt einem.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE server_rev_seq TO authenticated;
REVOKE ALL ON SCHEMA public FROM anon;
REVOKE ALL ON SEQUENCE server_rev_seq FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON settings TO authenticated;
REVOKE ALL ON settings FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON devices TO authenticated;
REVOKE ALL ON devices FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON tags TO authenticated;
REVOKE ALL ON tags FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON taggables TO authenticated;
REVOKE ALL ON taggables FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON links TO authenticated;
REVOKE ALL ON links FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON attachments TO authenticated;
REVOKE ALL ON attachments FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON import_batches TO authenticated;
REVOKE ALL ON import_batches FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON accounts TO authenticated;
REVOKE ALL ON accounts FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO authenticated;
REVOKE ALL ON categories FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON transactions TO authenticated;
REVOKE ALL ON transactions FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON budgets TO authenticated;
REVOKE ALL ON budgets FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_rules TO authenticated;
REVOKE ALL ON recurring_rules FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON monthly_closings TO authenticated;
REVOKE ALL ON monthly_closings FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON finance_day_runs TO authenticated;
REVOKE ALL ON finance_day_runs FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO authenticated;
REVOKE ALL ON projects FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO authenticated;
REVOKE ALL ON tasks FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON time_blocks TO authenticated;
REVOKE ALL ON time_blocks FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_events TO authenticated;
REVOKE ALL ON calendar_events FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON day_types TO authenticated;
REVOKE ALL ON day_types FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON day_assignments TO authenticated;
REVOKE ALL ON day_assignments FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON shift_patterns TO authenticated;
REVOKE ALL ON shift_patterns FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON holidays TO authenticated;
REVOKE ALL ON holidays FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON metrics TO authenticated;
REVOKE ALL ON metrics FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON metric_entries TO authenticated;
REVOKE ALL ON metric_entries FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON metric_targets TO authenticated;
REVOKE ALL ON metric_targets FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON exercises TO authenticated;
REVOKE ALL ON exercises FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON workout_plans TO authenticated;
REVOKE ALL ON workout_plans FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON workout_plan_days TO authenticated;
REVOKE ALL ON workout_plan_days FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON workout_plan_exercises TO authenticated;
REVOKE ALL ON workout_plan_exercises FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON workout_sessions TO authenticated;
REVOKE ALL ON workout_sessions FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON workout_sets TO authenticated;
REVOKE ALL ON workout_sets FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON body_measurements TO authenticated;
REVOKE ALL ON body_measurements FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON progress_photos TO authenticated;
REVOKE ALL ON progress_photos FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON goals TO authenticated;
REVOKE ALL ON goals FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON goal_contributions TO authenticated;
REVOKE ALL ON goal_contributions FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO authenticated;
REVOKE ALL ON notes FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;
REVOKE ALL ON notifications FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON insights TO authenticated;
REVOKE ALL ON insights FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON task_templates TO authenticated;
REVOKE ALL ON task_templates FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON account_checks TO authenticated;
REVOKE ALL ON account_checks FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON shopping_items TO authenticated;
REVOKE ALL ON shopping_items FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON day_notes TO authenticated;
REVOKE ALL ON day_notes FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON investments TO authenticated;
REVOKE ALL ON investments FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON investment_moves TO authenticated;
REVOKE ALL ON investment_moves FROM anon;


-- Zeilensicherheit: Jede Tabelle ist standardmäßig gesperrt und gibt nur die
-- eigenen Zeilen frei. Das ist die wichtigste Schutzmaßnahme überhaupt –
-- eine Tabelle ohne diese Regeln wäre für jeden mit dem öffentlichen
-- Schlüssel lesbar.

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_own ON settings;
CREATE POLICY settings_own ON settings FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS devices_own ON devices;
CREATE POLICY devices_own ON devices FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tags_own ON tags;
CREATE POLICY tags_own ON tags FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE taggables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS taggables_own ON taggables;
CREATE POLICY taggables_own ON taggables FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS links_own ON links;
CREATE POLICY links_own ON links FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attachments_own ON attachments;
CREATE POLICY attachments_own ON attachments FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_batches_own ON import_batches;
CREATE POLICY import_batches_own ON import_batches FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounts_own ON accounts;
CREATE POLICY accounts_own ON accounts FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categories_own ON categories;
CREATE POLICY categories_own ON categories FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transactions_own ON transactions;
CREATE POLICY transactions_own ON transactions FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budgets_own ON budgets;
CREATE POLICY budgets_own ON budgets FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE recurring_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_rules_own ON recurring_rules;
CREATE POLICY recurring_rules_own ON recurring_rules FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE monthly_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS monthly_closings_own ON monthly_closings;
CREATE POLICY monthly_closings_own ON monthly_closings FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE finance_day_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_day_runs_own ON finance_day_runs;
CREATE POLICY finance_day_runs_own ON finance_day_runs FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_own ON projects;
CREATE POLICY projects_own ON projects FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasks_own ON tasks;
CREATE POLICY tasks_own ON tasks FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE time_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS time_blocks_own ON time_blocks;
CREATE POLICY time_blocks_own ON time_blocks FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_events_own ON calendar_events;
CREATE POLICY calendar_events_own ON calendar_events FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE day_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS day_types_own ON day_types;
CREATE POLICY day_types_own ON day_types FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE day_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS day_assignments_own ON day_assignments;
CREATE POLICY day_assignments_own ON day_assignments FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE shift_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_patterns_own ON shift_patterns;
CREATE POLICY shift_patterns_own ON shift_patterns FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS holidays_own ON holidays;
CREATE POLICY holidays_own ON holidays FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metrics_own ON metrics;
CREATE POLICY metrics_own ON metrics FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE metric_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metric_entries_own ON metric_entries;
CREATE POLICY metric_entries_own ON metric_entries FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE metric_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metric_targets_own ON metric_targets;
CREATE POLICY metric_targets_own ON metric_targets FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exercises_own ON exercises;
CREATE POLICY exercises_own ON exercises FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE workout_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workout_plans_own ON workout_plans;
CREATE POLICY workout_plans_own ON workout_plans FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE workout_plan_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workout_plan_days_own ON workout_plan_days;
CREATE POLICY workout_plan_days_own ON workout_plan_days FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE workout_plan_exercises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workout_plan_exercises_own ON workout_plan_exercises;
CREATE POLICY workout_plan_exercises_own ON workout_plan_exercises FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workout_sessions_own ON workout_sessions;
CREATE POLICY workout_sessions_own ON workout_sessions FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE workout_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workout_sets_own ON workout_sets;
CREATE POLICY workout_sets_own ON workout_sets FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS body_measurements_own ON body_measurements;
CREATE POLICY body_measurements_own ON body_measurements FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE progress_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS progress_photos_own ON progress_photos;
CREATE POLICY progress_photos_own ON progress_photos FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS goals_own ON goals;
CREATE POLICY goals_own ON goals FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE goal_contributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS goal_contributions_own ON goal_contributions;
CREATE POLICY goal_contributions_own ON goal_contributions FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notes_own ON notes;
CREATE POLICY notes_own ON notes FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_own ON notifications;
CREATE POLICY notifications_own ON notifications FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insights_own ON insights;
CREATE POLICY insights_own ON insights FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_templates_own ON task_templates;
CREATE POLICY task_templates_own ON task_templates FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE account_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_checks_own ON account_checks;
CREATE POLICY account_checks_own ON account_checks FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE shopping_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopping_items_own ON shopping_items;
CREATE POLICY shopping_items_own ON shopping_items FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE day_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS day_notes_own ON day_notes;
CREATE POLICY day_notes_own ON day_notes FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS investments_own ON investments;
CREATE POLICY investments_own ON investments FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE investment_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS investment_moves_own ON investment_moves;
CREATE POLICY investment_moves_own ON investment_moves FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- Neuigkeiten-Anzeiger
--
-- Ohne diesen Blick müsste ein Gerät alle 44 Tabellen einzeln
-- abfragen, nur um festzustellen, dass sich nichts getan hat. Mit ihm genügt
-- eine Anfrage: Ist der Zählerstand höher als der zuletzt gesehene, lohnt sich
-- ein Abgleich.
--
-- security_invoker = true ist hier entscheidend: Ohne diese Angabe liefe die
-- Ansicht mit den Rechten ihres Erstellers und würde die Zeilensicherheit
-- umgehen. So gilt sie auch hier, und jeder sieht nur den eigenen Stand.
CREATE OR REPLACE VIEW sync_head WITH (security_invoker = true) AS
SELECT max(rev) AS server_rev FROM (
  SELECT max(server_rev) AS rev FROM settings
  UNION ALL
  SELECT max(server_rev) AS rev FROM devices
  UNION ALL
  SELECT max(server_rev) AS rev FROM tags
  UNION ALL
  SELECT max(server_rev) AS rev FROM taggables
  UNION ALL
  SELECT max(server_rev) AS rev FROM links
  UNION ALL
  SELECT max(server_rev) AS rev FROM attachments
  UNION ALL
  SELECT max(server_rev) AS rev FROM import_batches
  UNION ALL
  SELECT max(server_rev) AS rev FROM accounts
  UNION ALL
  SELECT max(server_rev) AS rev FROM categories
  UNION ALL
  SELECT max(server_rev) AS rev FROM transactions
  UNION ALL
  SELECT max(server_rev) AS rev FROM budgets
  UNION ALL
  SELECT max(server_rev) AS rev FROM recurring_rules
  UNION ALL
  SELECT max(server_rev) AS rev FROM monthly_closings
  UNION ALL
  SELECT max(server_rev) AS rev FROM finance_day_runs
  UNION ALL
  SELECT max(server_rev) AS rev FROM projects
  UNION ALL
  SELECT max(server_rev) AS rev FROM tasks
  UNION ALL
  SELECT max(server_rev) AS rev FROM time_blocks
  UNION ALL
  SELECT max(server_rev) AS rev FROM calendar_events
  UNION ALL
  SELECT max(server_rev) AS rev FROM day_types
  UNION ALL
  SELECT max(server_rev) AS rev FROM day_assignments
  UNION ALL
  SELECT max(server_rev) AS rev FROM shift_patterns
  UNION ALL
  SELECT max(server_rev) AS rev FROM holidays
  UNION ALL
  SELECT max(server_rev) AS rev FROM metrics
  UNION ALL
  SELECT max(server_rev) AS rev FROM metric_entries
  UNION ALL
  SELECT max(server_rev) AS rev FROM metric_targets
  UNION ALL
  SELECT max(server_rev) AS rev FROM exercises
  UNION ALL
  SELECT max(server_rev) AS rev FROM workout_plans
  UNION ALL
  SELECT max(server_rev) AS rev FROM workout_plan_days
  UNION ALL
  SELECT max(server_rev) AS rev FROM workout_plan_exercises
  UNION ALL
  SELECT max(server_rev) AS rev FROM workout_sessions
  UNION ALL
  SELECT max(server_rev) AS rev FROM workout_sets
  UNION ALL
  SELECT max(server_rev) AS rev FROM body_measurements
  UNION ALL
  SELECT max(server_rev) AS rev FROM progress_photos
  UNION ALL
  SELECT max(server_rev) AS rev FROM goals
  UNION ALL
  SELECT max(server_rev) AS rev FROM goal_contributions
  UNION ALL
  SELECT max(server_rev) AS rev FROM notes
  UNION ALL
  SELECT max(server_rev) AS rev FROM notifications
  UNION ALL
  SELECT max(server_rev) AS rev FROM insights
  UNION ALL
  SELECT max(server_rev) AS rev FROM task_templates
  UNION ALL
  SELECT max(server_rev) AS rev FROM account_checks
  UNION ALL
  SELECT max(server_rev) AS rev FROM shopping_items
  UNION ALL
  SELECT max(server_rev) AS rev FROM day_notes
  UNION ALL
  SELECT max(server_rev) AS rev FROM investments
  UNION ALL
  SELECT max(server_rev) AS rev FROM investment_moves
) AS alle;

GRANT SELECT ON sync_head TO authenticated;
REVOKE ALL ON sync_head FROM anon;


-- Prüfung: Es darf weder eine Tabelle ohne Zeilensicherheit noch eine ohne
-- Regel geben. Die Abfrage geht bewusst über pg_class samt Schema – ein
-- Vergleich allein über den Namen würde auch Indizes treffen und die Prüfung
-- damit wertlos machen.
DO $$
DECLARE ohne_rls text; ohne_regel text; anon_rechte text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO ohne_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  SELECT string_agg(c.relname, ', ') INTO ohne_regel
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = c.relname
    );

  IF ohne_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Tabellen ohne Zeilensicherheit: %', ohne_rls;
  END IF;
  IF ohne_regel IS NOT NULL THEN
    RAISE EXCEPTION 'Tabellen ohne Zugriffsregel: %', ohne_regel;
  END IF;

  SELECT string_agg(DISTINCT table_name, ', ') INTO anon_rechte
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee = 'anon';
  IF anon_rechte IS NOT NULL THEN
    RAISE EXCEPTION 'Der oeffentliche Schluessel haette noch Rechte auf: %', anon_rechte;
  END IF;

  RAISE NOTICE 'Schema vollstaendig: alle Tabellen sind gesichert, anon hat keine Rechte.';
END $$;
