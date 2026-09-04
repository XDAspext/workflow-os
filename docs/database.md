# Database

SQLite via libSQL for local development (`DATABASE_URL=file:./data/workflow-os.db`). PostgreSQL is required in production (`DATABASE_URL=postgres://...`). Both dialects share the same table names and application queries. Schema sources: `src/db/schema.sqlite.ts` and `src/db/schema.pg.ts`.

Tables:

- `users`, `organizations`, `memberships`
- `projects`
- `workflows`, `workflow_versions`, `workflow_nodes`, `workflow_edges`
- `executions`, `execution_steps`
- `approvals`
- `integrations`, `secrets`
- `templates`
- `audit_logs`
- `usage_events`
- `execution_receipts` (append-only cryptographic proofs; `execution_id` is not unique)

The editor's source of truth is `workflow_versions.definition` (JSON). Node and edge rows are a queryable projection written on save/publish.

Apply schema: `npm run db:migrate` or `ensureMigrated()` on boot. SQLite uses `CREATE TABLE IF NOT EXISTS`. PostgreSQL uses the statements in `src/db/migrate.pg.ts` / `drizzle/pg/0000_init.sql`.

Organizations have `is_demo` for the isolated FlowForge Demo workspace.

Workflows have `verify_on_chain` (default false) and `last_scheduled_at` (worker cursor so `schedule.trigger` fires at most once per UTC minute). When a run finishes, FlowForge writes `execution_receipts` with a SHA-256 root of a canonical execution snapshot. Inputs and outputs are hashed, not stored in the receipt. Blockchain, if enabled, stores only that root.

Indexes cover org-scoped listing, webhook tokens, execution status, and audit time.
