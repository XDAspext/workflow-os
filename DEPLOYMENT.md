# Deployment

FlowForge is three pieces:

1. A **Next.js** web app (`npm start`)
2. A **PostgreSQL** database
3. A **separate worker** process (`npm run worker`) that polls for queued executions

Do not run workflow execution inside the browser. Do not rely on the Next.js request lifecycle to finish runs in production.

This file is host-agnostic. The same commands work on a VPS, Railway, Render, Fly.io, or Docker. Vercel is optional for the web app only, and still requires a worker elsewhere because Vercel dynos are not a durable poller.

---

## Required services

| Service | Role |
| --- | --- |
| Node.js 22 | Web app and worker |
| PostgreSQL 16 | Production database |
| SpaceXAI / xAI API key (optional) | Live model calls; mock provider is used if unset |

SQLite (`file:./data/workflow-os.db`) remains the local development default. Production refuses to start without a `postgres://` or `postgresql://` `DATABASE_URL`.

---

## Generate secrets

```bash
openssl rand -base64 48   # AUTH_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY
```

Never commit these values. Never prefix them with `NEXT_PUBLIC_`. API keys stay server-side.

---

## Environment variables

| Variable | Required in production | Purpose |
| --- | --- | --- |
| `APP_URL` | yes | Public origin, e.g. `https://flowforge.example.com`. Used for webhook URLs. Must not be localhost. |
| `NODE_ENV` | yes | `production` |
| `AUTH_SECRET` | yes | Signs session cookies. ≥ 32 characters. |
| `ENCRYPTION_KEY` | yes | AES-256-GCM for workspace secrets. 64 hex chars recommended. |
| `DATABASE_URL` | yes | `postgres://user:password@host:5432/workflow_os` |
| `DEMO_EMAIL` | for demo seed | Isolated demo account email |
| `DEMO_PASSWORD` | for demo seed | Demo password (never hardcoded for production) |
| `XAI_API_KEY` | recommended | SpaceXAI / xAI. Server only. |
| `XAI_BASE_URL` | no | Default `https://api.x.ai/v1` |
| `XAI_MODEL` | no | Default `grok-4.6` |
| `SEED_ON_BOOT` | must be unset/false | Production refuses to start if this is `true` |
| `ENABLE_EMBEDDED_WORKER` | no | Default off in production. Keep the worker as its own process. |
| `ALLOW_SIGNUP` | no | Default off in production. Set `true` only if you want public signup. |
| `EXECUTE_INLINE` | no | Default off in production. Web enqueues; worker runs. |
| `WORKER_POLL_MS` | no | Default `1000` in production |
| `WORKER_LOCK_MS` | no | Stale lock reclaim window. Default 5 minutes. |
| `WORKER_CONCURRENCY` | no | Parallel claimed runs per tick. Default `4` in production, `2` locally. Max `16`. |
| `WORKER_SECRET` | for Vercel Cron / HTTP tick | Bearer token for `GET|POST /api/ops/worker/tick`. Vercel Cron can use `CRON_SECRET` instead. |
| `DATABASE_POOL_MAX` | no | postgres.js pool size. Default `8`. |
| `DATABASE_SSL` | no | `require` or `disable`. Hosted Postgres usually needs TLS. |
| `COOKIE_SECURE` | no | Default `true` when `NODE_ENV=production`. Set `false` only for a temporary HTTP demo so the session cookie is stored. HTTPS is required for a real public demo. |
| `BLOCKCHAIN_ENABLED` | no | Default `false`. Workflows run without a chain. |
| `BLOCKCHAIN_MODE` | no | `demo` (default when enabled) or `evm` |
| `CHAIN_RPC_URL` | evm only | JSON-RPC endpoint |
| `CHAIN_ID` | evm only | Numeric chain id |
| `CHAIN_CONTRACT_ADDRESS` | evm only | Deployed `ExecutionRegistry` |
| `CHAIN_PRIVATE_KEY` | evm only | Server operator key. Never `NEXT_PUBLIC_`. |
| `CHAIN_EXPLORER_URL` | no | Used to link transaction hashes |
| `VERIFY_ON_CHAIN_DEFAULT` | no | Default for new workflows |
| `VERIFY_TEST_RUNS` | no | Default false. Test executions are not anchored. |

Copy `.env.example` and fill production values on the host. Do not put secrets in the client bundle.

---

## PostgreSQL setup

Create an empty database (managed Postgres or a VM):

```bash
createdb workflow_os
# or
psql -c "CREATE USER workflow WITH PASSWORD 'choose-a-strong-password';"
psql -c "CREATE DATABASE workflow_os OWNER workflow;"
```

Set:

```bash
export DATABASE_URL=postgres://workflow:choose-a-strong-password@127.0.0.1:5432/workflow_os
```

Hosted providers (Neon, RDS, Supabase, Railway Postgres, Render Postgres) give you the URL. Prefer a connection pooler if the host recommends one. Set `DATABASE_SSL=require` when the provider needs TLS.

---

## Migration commands

From the app directory, with production env loaded:

```bash
npm ci
npm run db:migrate
```

`db:migrate` applies the idempotent PostgreSQL schema in `drizzle/pg/0000_init.sql` (via `src/db/migrate.pg.ts`). `ensureMigrated()` also applies it on boot so a missed migrate does not crash the first request, but you should still run the command once during deploy.

SQLite local databases keep using `CREATE TABLE IF NOT EXISTS` in `src/db/migrate.ts`. Existing local files get an `is_demo` column patched in.

To generate future Drizzle artifacts:

```bash
npx drizzle-kit generate --config=drizzle.config.pg.ts
npx drizzle-kit generate --config=drizzle.config.ts
```

---

## Seed commands

Templates and the isolated **FlowForge Demo** workspace are **not** created on production boot.

```bash
# After migrate, once per environment (idempotent)
export DEMO_EMAIL=professor-demo@example.com
export DEMO_PASSWORD='choose-a-strong-demo-password'
npm run seed:demo
```

`npm run seed` is the same seeder (useful locally). Re-running `seed:demo` updates the demo password from the environment and will not duplicate workflows if they already exist.

The demo user belongs only to the FlowForge Demo workspace (`slug: demo-workspace`, `is_demo: true`). Seeded workflows, runs, and approvals are labeled `[Demo]` / `demo: true`. Fixtures use `@demo.example` addresses, not real personal data.

---

## Web deployment

```bash
npm ci
npm run db:migrate
npm run build
NODE_ENV=production npm start
```

`npm start` serves the Next.js app. In production the embedded poller is **off**. If you set `ENABLE_EMBEDDED_WORKER=true`, the web process will also poll — that is a last-resort single-box mode, not the recommended demo architecture.

Health check: `GET /api/health` → `{ ok: true, service: "workflow-os", db: "postgres" }`. The handler pings the database; a failed ping returns `503`.

---

## Worker deployment

Run the worker as a **second process** on the same image/code and the same `DATABASE_URL`.

Exact command:

```bash
NODE_ENV=production npm run worker
```

Startup check (exits 0 after migrate + config assert):

```bash
NODE_ENV=production npm run worker:check
```

The worker:

- loads `.env` from the working directory if present
- asserts production config (Postgres, `APP_URL`, secrets, no `SEED_ON_BOOT`)
- polls `queued` executions and due `waiting` delay rows
- enqueues published cron (`schedule.trigger`) workflows at most once per UTC minute
- expires timed-out approvals
- claims rows (`SKIP LOCKED` on PostgreSQL) so two workers cannot run the same execution
- runs up to `WORKER_CONCURRENCY` claimed executions in parallel
- marks crashed runs `failed` instead of leaving them locked
- re-queues stale `running` locks after `WORKER_LOCK_MS`
- handles `SIGINT` / `SIGTERM` and waits for the in-flight tick

If the web app is on Vercel, run `npm run worker` on a second host **or** set `WORKER_SECRET` / `CRON_SECRET` and let `vercel.json` hit `/api/ops/worker/tick` every minute. Long workflows still belong on the dedicated worker; the HTTP tick is a fallback with a 60s function budget.

systemd example:

```ini
[Service]
WorkingDirectory=/opt/workflow-os
EnvironmentFile=/opt/workflow-os/.env
ExecStart=/usr/bin/npm run worker
Restart=always
```

The same Docker image can run as web (`npm start`) or worker (`npm run worker`). See `docker-compose.yml`.

---

## Demo account setup

Exact command:

```bash
export DEMO_EMAIL=professor-demo@example.com
export DEMO_PASSWORD='choose-a-strong-demo-password'
npm run seed:demo
```

Give the professor:

- Public URL from `APP_URL`
- `DEMO_EMAIL`
- The password you set in `DEMO_PASSWORD` (out of band — not in git, not on the login page)

---

## Webhook configuration

Webhook URLs are `${APP_URL}/api/webhooks/:token`.

The editor copies that URL from `APP_URL`, not `window.location`, so a localhost origin cannot leak into a production webhook.

```
POST ${APP_URL}/api/webhooks/:token
```

- Rate limited (in-process; one web instance is enough for the demo)
- `Authorization`, `Cookie`, and `x-api-key` headers are stripped before storage
- Paused workflows return `423` and do not enqueue
- Production **enqueues only**; the worker executes the run

---

## Docker (optional)

```bash
export APP_URL=https://flowforge.example.com
export AUTH_SECRET=$(openssl rand -base64 48)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export DEMO_EMAIL=professor-demo@example.com
export DEMO_PASSWORD='choose-a-strong-demo-password'
export POSTGRES_PASSWORD='choose-a-strong-db-password'

docker compose up --build
docker compose exec web npm run seed:demo
```

Compose starts Postgres, migrates, starts the web app, and starts `npm run worker` as a second service.

---

## Blockchain verification (optional)

FlowForge stores workflow data in PostgreSQL. Blockchain is used only to store a cryptographic proof that important execution records existed in a particular state and have not been altered. This is not a claim of regulatory compliance.

Never stored on-chain: inputs, outputs, secrets, emails, or execution payloads. Only hashes and identifiers.

### Demo mode

```bash
BLOCKCHAIN_ENABLED=true
BLOCKCHAIN_MODE=demo
```

No RPC, wallet, or funds. Proofs are labeled **Demo verified**. Enable **Anchor successful production runs** on a workflow, run it, then open the run and **Verify integrity**. Public page: `/verify/{executionId}`.

### Real EVM

1. Deploy `contracts/ExecutionRegistry.sol` (Foundry example):

```bash
forge create contracts/ExecutionRegistry.sol:ExecutionRegistry \
  --rpc-url "$CHAIN_RPC_URL" \
  --private-key "$CHAIN_PRIVATE_KEY"
```

2. Set:

```bash
BLOCKCHAIN_ENABLED=true
BLOCKCHAIN_MODE=evm
CHAIN_RPC_URL=https://...
CHAIN_ID=11155111
CHAIN_CONTRACT_ADDRESS=0x...
CHAIN_PRIVATE_KEY=0x...
CHAIN_EXPLORER_URL=https://sepolia.etherscan.io
```

The worker (or inline runner in development) anchors after a terminal run. If anchoring fails, the workflow stays `success` or `failed` as the engine decided; the receipt is marked `failed` and can be retried.

## Local development

SQLite is unchanged:

```bash
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:3000. On an empty database, development still seeds a local demo workspace (`SEED_ON_BOOT=true` in `.env.example`).

Local demo defaults (development only):

- Email: `maya.chen@northstar.example`
- Password: `workflow-os-demo`

Override with `DEMO_EMAIL` / `DEMO_PASSWORD`. Production never uses those fallbacks.

Optional local worker (the Next.js dev server also polls):

```bash
npm run worker
```

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run worker:check
```

---

## Architecture reminder

```
Browser  →  Next.js (auth, editor, APIs)
                │ enqueue execution (status=queued)
                ▼
         PostgreSQL
                ▲
                │ poll / claim / run
         npm run worker
```
