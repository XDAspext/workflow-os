# Execution engine

`runWorkflow` walks the graph:

1. Start at the trigger (or a resume node)
2. Wait until inbound edges are completed or skipped
3. Resolve config against the variable scope
4. Call the handler
5. Honor error policy: `stop` | `continue` | `retry` | `fallback`
6. If the handler returns `pause`, persist `waiting`
7. Follow the selected branch; mark the other branch unreachable

Statuses: `queued`, `running`, `waiting`, `success`, `failed`, `cancelled`, `timed_out`.

Human approval:

- Handler returns `pause.kind = approval`
- An `approvals` row is created
- User decides in `/approvals`
- Execution is re-queued with `resumeFrom` and the decision branch

The worker claims `queued` rows and due `waiting` delays. PostgreSQL uses `FOR UPDATE SKIP LOCKED` so multiple workers do not run the same row. SQLite uses a compare-and-set update. Claimed runs execute in parallel up to `WORKER_CONCURRENCY`.

If a run throws, the worker marks it `failed` and releases the lock instead of leaving it `running` until stale-lock reclaim. A cancelled run is not overwritten when the in-flight worker finishes.

The same tick also:

- Enqueues published `schedule.trigger` workflows whose cron matches the current UTC minute (`last_scheduled_at` prevents double fire)
- Expires pending approvals past `timeout_at` and marks the execution `timed_out`

It does not run inside the original HTTP request lifecycle except as an optional local kick after enqueue.
