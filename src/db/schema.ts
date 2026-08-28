/**
 * Datenbankschema als nummerierte, aufwärtsgerichtete Migrationen.
 * Jede Migration wird genau einmal angewandt und in `_migrations` protokolliert.
 *
 * Basisfelder jeder synchronisierten Tabelle:
 *   id, created_at, updated_at, deleted_at, version, last_device_id, server_rev,
 *   _dirty (nur lokal), _conflict (nur lokal)
 */

const BASE = `
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  last_device_id TEXT NOT NULL DEFAULT '',
  server_rev     INTEGER,
  _dirty         INTEGER NOT NULL DEFAULT 1,
  _conflict      INTEGER NOT NULL DEFAULT 0
`

export type Migration = { id: number; name: string; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
    ---------------------------------------------------------------- Stammdaten
    CREATE TABLE settings (
      id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, value_json TEXT NOT NULL, ${BASE}
    );
    CREATE TABLE devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL,
      last_sync_at TEXT, app_version TEXT, ${BASE}
    );
    CREATE TABLE tags (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, scope TEXT, ${BASE}
    );
    CREATE TABLE taggables (
      id TEXT PRIMARY KEY, tag_id TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, ${BASE}
    );
    CREATE TABLE links (
      id TEXT PRIMARY KEY,
      from_type TEXT NOT NULL, from_id TEXT NOT NULL,
      to_type TEXT NOT NULL, to_id TEXT NOT NULL,
      relation TEXT NOT NULL, ${BASE}
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL, data_url TEXT, remote_path TEXT,
      upload_state TEXT NOT NULL DEFAULT 'pending',
      width INTEGER, height INTEGER, taken_at TEXT, ${BASE}
    );
    CREATE TABLE import_batches (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, filename TEXT,
      mapping_json TEXT NOT NULL, row_count INTEGER NOT NULL,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL, undone_at TEXT, ${BASE}
    );

    ----------------------------------------------------------------- Finanzen
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      opening_balance_cents INTEGER NOT NULL DEFAULT 0,
      opening_date TEXT NOT NULL,
      iban TEXT, institution TEXT, color TEXT, icon TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      counts_as_savings INTEGER NOT NULL DEFAULT 0,
      counts_as_available INTEGER NOT NULL DEFAULT 1,
      include_in_net_worth INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0, ${BASE}
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
      kind TEXT NOT NULL, color TEXT, icon TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      exclude_from_stats INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0, ${BASE}
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY, type TEXT NOT NULL,
      booked_on TEXT NOT NULL, value_on TEXT,
      amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'EUR',
      account_id TEXT NOT NULL, to_account_id TEXT, category_id TEXT,
      merchant TEXT, description TEXT, note TEXT,
      status TEXT NOT NULL DEFAULT 'booked',
      recurring_id TEXT, import_batch_id TEXT, external_ref TEXT, ${BASE}
    );
    CREATE INDEX ix_tx_date ON transactions(booked_on);
    CREATE INDEX ix_tx_account ON transactions(account_id);
    CREATE INDEX ix_tx_category ON transactions(category_id);
    CREATE TABLE budgets (
      id TEXT PRIMARY KEY, category_id TEXT,
      period TEXT NOT NULL DEFAULT 'monthly',
      amount_cents INTEGER NOT NULL,
      valid_from TEXT NOT NULL, valid_to TEXT,
      warn_at_percent INTEGER NOT NULL DEFAULT 80,
      rollover INTEGER NOT NULL DEFAULT 0, ${BASE}
    );
    CREATE TABLE recurring_rules (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
      rrule TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT,
      template_json TEXT NOT NULL,
      auto_book INTEGER NOT NULL DEFAULT 0,
      lead_days INTEGER NOT NULL DEFAULT 5,
      last_generated_on TEXT, is_active INTEGER NOT NULL DEFAULT 1, ${BASE}
    );
    CREATE TABLE monthly_closings (
      id TEXT PRIMARY KEY, year_month TEXT NOT NULL,
      closed_at TEXT, snapshot_json TEXT NOT NULL, ${BASE}
    );
    CREATE TABLE finance_day_runs (
      id TEXT PRIMARY KEY, ran_on TEXT NOT NULL,
      checklist_json TEXT NOT NULL, completed_at TEXT, note TEXT, ${BASE}
    );

    ------------------------------------------------------------------- Planer
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      color TEXT, status TEXT NOT NULL DEFAULT 'active', due_on TEXT, ${BASE}
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, note TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      bucket TEXT NOT NULL DEFAULT 'inbox',
      scheduled_on TEXT, scheduled_time TEXT,
      due_on TEXT, due_time TEXT,
      duration_minutes INTEGER, priority INTEGER NOT NULL DEFAULT 2,
      category TEXT, project_id TEXT, parent_task_id TEXT, recurring_id TEXT,
      completed_at TEXT, energy TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, ${BASE}
    );
    CREATE INDEX ix_task_sched ON tasks(scheduled_on);
    CREATE TABLE time_blocks (
      id TEXT PRIMARY KEY, day TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      kind TEXT NOT NULL, title TEXT NOT NULL, color TEXT,
      task_id TEXT, event_id TEXT,
      is_locked INTEGER NOT NULL DEFAULT 0, ${BASE}
    );

    ----------------------------------------------------------------- Kalender
    CREATE TABLE calendar_events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, location TEXT,
      day TEXT NOT NULL, start_time TEXT, end_time TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
      rrule TEXT, exdates TEXT, color TEXT,
      source TEXT NOT NULL DEFAULT 'local', external_uid TEXT, ${BASE}
    );
    CREATE INDEX ix_event_day ON calendar_events(day);
    CREATE TABLE day_types (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, short_code TEXT NOT NULL,
      kind TEXT NOT NULL, default_start TEXT, default_end TEXT,
      break_minutes INTEGER NOT NULL DEFAULT 0, color TEXT,
      counts_as_workday INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0, ${BASE}
    );
    CREATE TABLE day_assignments (
      id TEXT PRIMARY KEY, day TEXT NOT NULL, day_type_id TEXT NOT NULL,
      start_override TEXT, end_override TEXT, note TEXT, ${BASE}
    );
    CREATE UNIQUE INDEX ux_day_assign ON day_assignments(day);
    CREATE TABLE shift_patterns (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, cycle_days INTEGER NOT NULL,
      pattern_json TEXT NOT NULL, anchor_date TEXT NOT NULL,
      active_from TEXT NOT NULL, active_to TEXT, ${BASE}
    );
    CREATE TABLE holidays (
      id TEXT PRIMARY KEY, day TEXT NOT NULL, name TEXT NOT NULL,
      region TEXT NOT NULL, is_public INTEGER NOT NULL DEFAULT 1, ${BASE}
    );

    ----------------------------------------------------------------- Tracking
    CREATE TABLE metrics (
      id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      group_key TEXT NOT NULL, unit TEXT NOT NULL, value_type TEXT NOT NULL,
      decimals INTEGER NOT NULL DEFAULT 1,
      scale_min REAL, scale_max REAL, scale_labels_json TEXT,
      aggregation TEXT NOT NULL DEFAULT 'last',
      direction TEXT NOT NULL DEFAULT 'neutral',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      show_in_daily_form INTEGER NOT NULL DEFAULT 1,
      color TEXT, sort_order INTEGER NOT NULL DEFAULT 0, ${BASE}
    );
    CREATE TABLE metric_entries (
      id TEXT PRIMARY KEY, metric_id TEXT NOT NULL, day TEXT NOT NULL,
      at_time TEXT, value_num REAL, value_text TEXT, note TEXT,
      source TEXT NOT NULL DEFAULT 'manual', import_batch_id TEXT, ${BASE}
    );
    CREATE INDEX ix_me_metric_day ON metric_entries(metric_id, day);
    CREATE TABLE metric_targets (
      id TEXT PRIMARY KEY, metric_id TEXT NOT NULL,
      target_value REAL, tolerance_minus REAL, tolerance_plus REAL,
      hard_min REAL, hard_max REAL,
      period TEXT NOT NULL DEFAULT 'daily',
      valid_from TEXT NOT NULL, valid_to TEXT, ${BASE}
    );

    ----------------------------------------------------------------- Training
    CREATE TABLE exercises (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, muscle_groups TEXT,
      tracks_weight INTEGER NOT NULL DEFAULT 1,
      tracks_reps INTEGER NOT NULL DEFAULT 1,
      tracks_time INTEGER NOT NULL DEFAULT 0,
      is_bodyweight INTEGER NOT NULL DEFAULT 0, note TEXT, ${BASE}
    );
    CREATE TABLE workout_plans (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      cycle_weeks INTEGER NOT NULL DEFAULT 2, anchor_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, ${BASE}
    );
    CREATE TABLE workout_plan_days (
      id TEXT PRIMARY KEY, plan_id TEXT NOT NULL,
      week_index INTEGER NOT NULL, weekday INTEGER NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'every',
      title TEXT NOT NULL, focus TEXT, ${BASE}
    );
    CREATE TABLE workout_plan_exercises (
      id TEXT PRIMARY KEY, plan_day_id TEXT NOT NULL, exercise_id TEXT NOT NULL,
      target_sets INTEGER, target_reps TEXT, target_weight_kg REAL,
      rest_seconds INTEGER, sort_order INTEGER NOT NULL DEFAULT 0, ${BASE}
    );
    CREATE TABLE workout_sessions (
      id TEXT PRIMARY KEY, day TEXT NOT NULL, plan_day_id TEXT,
      title TEXT NOT NULL, type TEXT,
      started_at TEXT, ended_at TEXT, duration_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'planned',
      perceived_effort INTEGER, note TEXT, ${BASE}
    );
    CREATE TABLE workout_sets (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, exercise_id TEXT NOT NULL,
      set_index INTEGER NOT NULL, reps INTEGER, weight_kg REAL,
      seconds INTEGER, distance_m REAL,
      is_warmup INTEGER NOT NULL DEFAULT 0, note TEXT, ${BASE}
    );

    ------------------------------------------------------------ Körper, Ziele
    CREATE TABLE body_measurements (
      id TEXT PRIMARY KEY, day TEXT NOT NULL,
      weight_kg REAL, waist_cm REAL, chest_cm REAL, upper_arm_cm REAL,
      shoulder_cm REAL, thigh_cm REAL, neck_cm REAL,
      body_fat_percent REAL, method TEXT, note TEXT, ${BASE}
    );
    CREATE TABLE progress_photos (
      id TEXT PRIMARY KEY, day TEXT NOT NULL, pose TEXT NOT NULL,
      attachment_id TEXT NOT NULL, weight_kg REAL, note TEXT, ${BASE}
    );
    CREATE TABLE goals (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      domain TEXT NOT NULL, goal_kind TEXT NOT NULL,
      target_account_id TEXT, metric_id TEXT, manual_current REAL,
      start_value REAL, target_value REAL,
      start_on TEXT NOT NULL, target_on TEXT,
      status TEXT NOT NULL DEFAULT 'active', color TEXT, icon TEXT, ${BASE}
    );
    CREATE TABLE goal_contributions (
      id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, day TEXT NOT NULL,
      amount REAL NOT NULL, transaction_id TEXT, note TEXT, ${BASE}
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY, title TEXT, body TEXT NOT NULL, day TEXT,
      pinned INTEGER NOT NULL DEFAULT 0, ${BASE}
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
      scheduled_for TEXT NOT NULL, delivered_at TEXT, dismissed_at TEXT,
      entity_type TEXT, entity_id TEXT, ${BASE}
    );
    CREATE TABLE insights (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, severity TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, evidence_json TEXT NOT NULL,
      period_start TEXT, period_end TEXT,
      is_statistical INTEGER NOT NULL DEFAULT 0, dismissed_at TEXT, ${BASE}
    );

    ------------------------------------------------- Sync (rein lokale Tabellen)
    CREATE TABLE sync_state (
      table_name TEXT PRIMARY KEY,
      last_server_rev INTEGER NOT NULL DEFAULT 0,
      last_pull_at TEXT, last_push_at TEXT
    );
    CREATE TABLE change_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL, row_id TEXT NOT NULL, op TEXT NOT NULL,
      changed_fields TEXT NOT NULL, base_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
    );
    CREATE TABLE conflicts (
      id TEXT PRIMARY KEY, table_name TEXT NOT NULL, row_id TEXT NOT NULL,
      local_json TEXT NOT NULL, remote_json TEXT NOT NULL, merged_json TEXT,
      strategy TEXT NOT NULL, detected_at TEXT NOT NULL,
      resolved_at TEXT, resolved_by TEXT
    );
    `,
  },
  {
    id: 2,
    name: 'ziele_prozent_und_aufgabenvorlagen',
    sql: `
    -- Ziele können ihren Fortschritt direkt als Prozentwert führen,
    -- statt über Start- und Zielwert.
    ALTER TABLE goals ADD COLUMN progress_percent REAL;
    ALTER TABLE goals ADD COLUMN completed_on TEXT;

    -- Aufgabenvorlagen: "immer dienstags, wenn Spätschicht ist, Auto putzen"
    CREATE TABLE task_templates (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      duration_minutes INTEGER,
      priority INTEGER NOT NULL DEFAULT 2,
      weekday INTEGER,              -- 1 = Montag … 7 = Sonntag, NULL = jeder Tag
      day_type_id TEXT,             -- nur an Tagen dieser Tagesart
      interval_weeks INTEGER NOT NULL DEFAULT 1,
      anchor_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_generated_on TEXT,
      ${BASE}
    );

    -- Merker, aus welcher Vorlage eine Aufgabe entstanden ist
    ALTER TABLE tasks ADD COLUMN template_id TEXT;
    `,
  },
  {
    id: 3,
    name: 'zielbereich_anzeige_und_belege',
    sql: `
    -- Nicht bei jedem Wert ist eine Ampel sinnvoll. Bei Energie, Stimmung
    -- oder Schlaf lenkt sie eher ab, als dass sie hilft.
    ALTER TABLE metrics ADD COLUMN show_zone INTEGER NOT NULL DEFAULT 1;

    -- Kontenabgleich: festgehalten, wann welcher Kontostand geprüft wurde
    CREATE TABLE account_checks (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      day TEXT NOT NULL,
      expected_cents INTEGER NOT NULL,
      actual_cents INTEGER NOT NULL,
      correction_id TEXT,
      note TEXT,
      ${BASE}
    );
    `,
  },
  {
    id: 4,
    name: 'einkaufszettel_und_aufgabenfristen',
    sql: `
    ---------------------------------------------------------------- Einkauf
    -- Ein Zettel, der auch im Laden funktioniert: antippen, abhaken, fertig.
    -- Häufig Gebrauchtes bleibt als Vorlage stehen, statt jedes Mal neu
    -- getippt zu werden.
    CREATE TABLE shopping_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      quantity TEXT,                 -- "2", "500 g", "1 Packung" – bewusst Freitext
      aisle TEXT,                    -- grobe Sortierung im Laden, z. B. "Obst"
      note TEXT,
      is_checked INTEGER NOT NULL DEFAULT 0,
      checked_at TEXT,
      is_template INTEGER NOT NULL DEFAULT 0,   -- Vorrat an häufigen Artikeln
      times_used INTEGER NOT NULL DEFAULT 0,
      estimated_cents INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      ${BASE}
    );
    CREATE INDEX ix_shopping_open ON shopping_items(is_checked);

    ---------------------------------------------------------------- Aufgaben
    -- Drei Arten von Aufgabe, ohne dass man sich eine Art aussuchen muss:
    --
    --   fest      pinned_day = 1  – bleibt an ihrem Tag stehen
    --   täglich   scheduled_on    – wandert mit, bis sie erledigt ist
    --   Frist     due_on          – taucht erst ab show_from auf
    --
    -- show_from ist der Grund, warum eine Aufgabe mit halbjähriger Frist nicht
    -- ein halbes Jahr lang jeden Morgen im Weg steht.
    ALTER TABLE tasks ADD COLUMN show_from TEXT;
    ALTER TABLE tasks ADD COLUMN pinned_day INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN carried_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN carried_from TEXT;
    CREATE INDEX ix_task_due ON tasks(due_on);

    ---------------------------------------------------------------- Kalender
    -- Ein Termin kann über mehrere Tage gehen (Urlaub, Trainingslager) und
    -- eine Erinnerung tragen. Die Erinnerung sind Minuten vor Beginn.
    ALTER TABLE calendar_events ADD COLUMN end_day TEXT;
    ALTER TABLE calendar_events ADD COLUMN reminder_minutes INTEGER;
    `,
  },
  {
    id: 5,
    name: 'aufgaben_zeitraum_und_teilfortschritt',
    sql: `
    ---------------------------------------------------------------- Aufgaben
    -- Eine Aufgabe kann über mehrere Tage gehen (z. B. ein Wochenende) und
    -- aus mehreren Teilen bestehen, die man einzeln abhaken kann (z. B. "4
    -- Teile 3D-drucken" -> 1/4, 2/4 …). Ohne scheduled_end_on/progress_total
    -- verhält sich eine Aufgabe exakt wie vorher.
    ALTER TABLE tasks ADD COLUMN scheduled_end_on TEXT;
    ALTER TABLE tasks ADD COLUMN progress_total INTEGER;
    ALTER TABLE tasks ADD COLUMN progress_done INTEGER;
    `,
  },
]

/** Tabellen, die synchronisiert werden (alle außer den rein lokalen). */
export const SYNCED_TABLES = [
  'settings', 'devices', 'tags', 'taggables', 'links', 'attachments', 'import_batches',
  'accounts', 'categories', 'transactions', 'budgets', 'recurring_rules',
  'monthly_closings', 'finance_day_runs',
  'projects', 'tasks', 'time_blocks',
  'calendar_events', 'day_types', 'day_assignments', 'shift_patterns', 'holidays',
  'metrics', 'metric_entries', 'metric_targets',
  'exercises', 'workout_plans', 'workout_plan_days', 'workout_plan_exercises',
  'workout_sessions', 'workout_sets',
  'body_measurements', 'progress_photos', 'goals', 'goal_contributions',
  'notes', 'notifications', 'insights', 'task_templates', 'account_checks',
  'shopping_items',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]

export const LOCAL_ONLY_TABLES = ['sync_state', 'change_log', 'conflicts', '_migrations']
