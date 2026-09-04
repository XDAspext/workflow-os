-- Cursor used by the worker to enqueue schedule.trigger workflows at most once per minute.

ALTER TABLE workflows ADD COLUMN IF NOT EXISTS last_scheduled_at TIMESTAMPTZ;

INSERT INTO schema_migrations (id) VALUES ('0002_schedule_cursor') ON CONFLICT (id) DO NOTHING;
