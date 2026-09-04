import type { Client } from "@libsql/client";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color TEXT NOT NULL DEFAULT '#c96442',
    onboarded_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email)`,
  `CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS orgs_slug_idx ON organizations(slug)`,
  `CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor',
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS memberships_org_user_idx ON memberships(organization_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id)`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_org_slug_idx ON projects(organization_id, slug)`,
  `CREATE INDEX IF NOT EXISTS projects_org_idx ON projects(organization_id)`,
  `CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    published_version_id TEXT,
    webhook_token TEXT,
    verify_on_chain INTEGER NOT NULL DEFAULT 0,
    last_scheduled_at INTEGER,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS workflows_org_idx ON workflows(organization_id)`,
  `CREATE INDEX IF NOT EXISTS workflows_project_idx ON workflows(project_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS workflows_webhook_idx ON workflows(webhook_token)`,
  `CREATE TABLE IF NOT EXISTS workflow_versions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    definition TEXT NOT NULL,
    hash TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    published_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS workflow_versions_wf_ver_idx ON workflow_versions(workflow_id, version)`,
  `CREATE INDEX IF NOT EXISTS workflow_versions_wf_idx ON workflow_versions(workflow_id)`,
  `CREATE TABLE IF NOT EXISTS workflow_nodes (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    position_x INTEGER NOT NULL DEFAULT 0,
    position_y INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS workflow_nodes_version_key_idx ON workflow_nodes(version_id, node_key)`,
  `CREATE INDEX IF NOT EXISTS workflow_nodes_type_idx ON workflow_nodes(type)`,
  `CREATE TABLE IF NOT EXISTS workflow_edges (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
    edge_key TEXT NOT NULL,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    source_handle TEXT,
    target_handle TEXT,
    label TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS workflow_edges_version_idx ON workflow_edges(version_id)`,
  `CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id),
    status TEXT NOT NULL DEFAULT 'queued',
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    triggered_by TEXT,
    input TEXT,
    output TEXT,
    error TEXT,
    resume_from TEXT,
    locked_at INTEGER,
    locked_by TEXT,
    wait_until INTEGER,
    started_at INTEGER,
    ended_at INTEGER,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS executions_org_created_idx ON executions(organization_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS executions_workflow_idx ON executions(workflow_id)`,
  `CREATE INDEX IF NOT EXISTS executions_status_idx ON executions(status)`,
  `CREATE INDEX IF NOT EXISTS executions_wait_idx ON executions(status, wait_until)`,
  `CREATE TABLE IF NOT EXISTS execution_receipts (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    root TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    chain_id TEXT,
    tx_hash TEXT,
    block_number TEXT,
    contract_address TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    verified_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS execution_receipts_exec_seq_idx ON execution_receipts(execution_id, sequence)`,
  `CREATE INDEX IF NOT EXISTS execution_receipts_org_idx ON execution_receipts(organization_id)`,
  `CREATE INDEX IF NOT EXISTS execution_receipts_exec_idx ON execution_receipts(execution_id)`,
  `CREATE INDEX IF NOT EXISTS execution_receipts_status_idx ON execution_receipts(status)`,
  `CREATE TABLE IF NOT EXISTS execution_steps (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    node_type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt INTEGER NOT NULL DEFAULT 1,
    input TEXT,
    output TEXT,
    config TEXT,
    error TEXT,
    logs TEXT NOT NULL DEFAULT '[]',
    started_at INTEGER,
    ended_at INTEGER,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS execution_steps_run_idx ON execution_steps(execution_id)`,
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    payload TEXT,
    comment TEXT,
    timeout_at INTEGER,
    resolved_by TEXT,
    resolved_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS approvals_org_status_idx ON approvals(organization_id, status)`,
  `CREATE INDEX IF NOT EXISTS approvals_execution_idx ON approvals(execution_id)`,
  `CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    config TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS integrations_org_idx ON integrations(organization_id)`,
  `CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    encrypted_value TEXT NOT NULL,
    last_four TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS secrets_org_name_idx ON secrets(organization_id, name)`,
  `CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    definition TEXT NOT NULL,
    featured INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS templates_slug_idx ON templates(slug)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS audit_org_created_idx ON audit_logs(organization_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_logs(action)`,
  `CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    metadata TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS usage_org_kind_idx ON usage_events(organization_id, kind)`,
  `CREATE INDEX IF NOT EXISTS usage_org_created_idx ON usage_events(organization_id, created_at)`,
];

export async function applySchema(client: Client): Promise<void> {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA journal_mode = WAL");
  for (const statement of STATEMENTS) {
    await client.execute(statement);
  }
  try {
    await client.execute(
      "ALTER TABLE organizations ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0",
    );
  } catch {
    // Column already exists on databases created after this patch.
  }
  try {
    await client.execute(
      "ALTER TABLE workflows ADD COLUMN verify_on_chain INTEGER NOT NULL DEFAULT 0",
    );
  } catch {
    // Column already exists on databases created after this patch.
  }
  try {
    await client.execute("ALTER TABLE workflows ADD COLUMN last_scheduled_at INTEGER");
  } catch {
    // Column already exists on databases created after this patch.
  }
}
