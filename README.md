# FlowForge

AI-native workflow automation and orchestration platform.

FlowForge is a visual builder plus a real execution engine. It is not a slideshow of fake nodes. Definitions, versions, runs, approvals, and secrets are persisted. A worker — not the HTTP request — executes queued work.

**Trigger → Process → Decide → Act → Verify**

---

## Why it exists

Most automation tools are either too technical for operators or too opaque(hard to understand) for people who have to approve what an AI is about to send. FlowForge is built around:

- A canvas that a non-technical user can follow
- Typed node definitions a developer can extend
- Deterministic execution with visible failures
- Human approval as a first-class pause state
- Multiple AI providers behind one interface (SpaceXAI / xAI by default)

---

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 App Router, React 19, TypeScript (strict) |
| UI | Tailwind 4, IBM Plex, Radix, React Flow |
| Data | Drizzle ORM + libSQL / SQLite locally, PostgreSQL in production |
| Execution | `npm run worker` (embedded poller in development only) |
| AI | SpaceXAI (`XAI_API_KEY`, `https://api.x.ai/v1`, `grok-4.6`) with mock fallback |

Frontend, domain, database, and execution are separated under `src/`. Adding a node type does not require rewriting the editor.

FlowForge stores workflow data in PostgreSQL (SQLite locally). Blockchain is used only to store a cryptographic proof that important execution records existed in a particular state and have not been altered. It is not a regulatory-compliance feature.

---

## Local setup

```bash
cd workflow-os
npm install
cp .env.example .env   # already created for local use
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Local demo workspace (seeded on first boot in development):

- Email: `maya.chen@northstar.example`
- Password: `workflow-os-demo` (local default only; production uses `DEMO_PASSWORD`)

Public demo setup: see [DEPLOYMENT.md](DEPLOYMENT.md).

To talk to a live model instead of the mock provider:

```bash
# https://console.x.ai
export XAI_API_KEY=...
```

Optional dedicated worker (the Next.js process also polls in development):

```bash
npm run worker
```

---

## Environment

See `.env.example`. Important values:

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs session cookies |
| `ENCRYPTION_KEY` | AES-256-GCM for workspace secrets (falls back to `AUTH_SECRET`) |
| `DATABASE_URL` | `file:./data/workflow-os.db` locally; `postgres://...` in production |
| `XAI_API_KEY` | Server-side only. Never sent to the browser |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | Isolated demo account. Password is never shown in the UI |
| `SEED_ON_BOOT` | Local only. Must not be enabled in production |
| `BLOCKCHAIN_ENABLED` | Optional verification layer. Default `false`. Never required to run workflows |

---

## Tests

```bash
npm test           # unit + integration (vitest)
npm run typecheck
npm run test:e2e   # Playwright smoke (starts its own server)
```

Covered today:

- Expression evaluation (no `eval`)
- Permissions
- Graph validation
- Execution state transitions, branching, approval resume, continue-on-error
- Provider fallback
- Persisted execution against SQLite
- Cancel, retry guards, schedule enqueue, worker crash isolation

---

## Architecture (short)

```
Workflow definition (draft)
        │ publish
        ▼
Workflow version (immutable)
        │ enqueue
        ▼
Execution (queued → running → waiting | success | failed)
        │
        ├─ Execution steps (one per node, independently inspectable)
        └─ Approvals (pause / resume)
```

Nodes are registered as `{ definition, handler }`. The canvas only knows about definitions. The engine only knows about handlers.

Docs:

- [Architecture](docs/architecture.md)
- [Database](docs/database.md)
- [Workflow format](docs/workflow-format.md)
- [Node system](docs/node-system.md)
- [Execution engine](docs/execution-engine.md)
- [Integrations](docs/integrations.md)
- [Local development](docs/development.md)
- [Deployment](docs/deployment.md)
- [User guide](docs/user-guide.md)

---

## Roadmap

- Redis-backed queue for multi-region workers
- Native Slack / GitHub / Drive adapters
- Full payment collection on the existing usage abstraction
- Multi-item loop subgraphs with parallelism caps
- SSO / SCIM for enterprise workspaces

---

## License

Proprietary until otherwise stated. Built to be shown to a real team.
