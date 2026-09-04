# FlowForge Deployment

See [DEPLOYMENT.md](../DEPLOYMENT.md) for the full production runbook (Postgres, worker process, Docker, health checks, and optional Vercel Cron).

Production pieces:

- Next.js web app
- PostgreSQL
- A separate worker (`npm run worker`) that claims queued runs, fires cron schedules, and expires approvals

Vercel can host the web app. Long-running executions still need the dedicated worker, or the authenticated `/api/ops/worker/tick` fallback. Local development continues to use SQLite.
