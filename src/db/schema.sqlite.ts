import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

const timestampNull = (name: string) => integer(name, { mode: "timestamp_ms" });

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    avatarColor: text("avatar_color").notNull().default("#c96442"),
    onboardedAt: timestampNull("onboarded_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    plan: text("plan").notNull().default("free"),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [uniqueIndex("orgs_slug_idx").on(t.slug)],
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("editor"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    uniqueIndex("memberships_org_user_idx").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [
    uniqueIndex("projects_org_slug_idx").on(t.organizationId, t.slug),
    index("projects_org_idx").on(t.organizationId),
  ],
);

export const workflows = sqliteTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("draft"),
    publishedVersionId: text("published_version_id"),
    webhookToken: text("webhook_token"),
    verifyOnChain: integer("verify_on_chain", { mode: "boolean" }).notNull().default(false),
    lastScheduledAt: timestampNull("last_scheduled_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [
    index("workflows_org_idx").on(t.organizationId),
    index("workflows_project_idx").on(t.projectId),
    uniqueIndex("workflows_webhook_idx").on(t.webhookToken),
  ],
);

export const workflowVersions = sqliteTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: text("definition", { mode: "json" }).notNull().$type<{
      name: string;
      description?: string;
      graph: {
        nodes: Array<{
          id: string;
          type: string;
          name: string;
          position: { x: number; y: number };
          config: Record<string, unknown>;
          disabled?: boolean;
          notes?: string;
          errorPolicy?: {
            onError: "stop" | "continue" | "retry" | "fallback";
            retries?: number;
            retryDelayMs?: number;
            fallbackTarget?: string;
          };
        }>;
        edges: Array<{
          id: string;
          source: string;
          target: string;
          sourceHandle?: string;
          targetHandle?: string;
          label?: string;
        }>;
        viewport?: { x: number; y: number; zoom: number };
      };
      variables?: Record<string, unknown>;
    }>(),
    hash: text("hash").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    publishedAt: timestampNull("published_at"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    uniqueIndex("workflow_versions_wf_ver_idx").on(t.workflowId, t.version),
    index("workflow_versions_wf_idx").on(t.workflowId),
  ],
);

export const workflowNodes = sqliteTable(
  "workflow_nodes",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    config: text("config", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    positionX: integer("position_x").notNull().default(0),
    positionY: integer("position_y").notNull().default(0),
    disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("workflow_nodes_version_key_idx").on(t.versionId, t.nodeKey),
    index("workflow_nodes_type_idx").on(t.type),
  ],
);

export const workflowEdges = sqliteTable(
  "workflow_edges",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "cascade" }),
    edgeKey: text("edge_key").notNull(),
    source: text("source").notNull(),
    target: text("target").notNull(),
    sourceHandle: text("source_handle"),
    targetHandle: text("target_handle"),
    label: text("label"),
  },
  (t) => [index("workflow_edges_version_idx").on(t.versionId)],
);

export const executions = sqliteTable(
  "executions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id),
    status: text("status").notNull().default("queued"),
    triggerType: text("trigger_type").notNull().default("manual"),
    triggeredBy: text("triggered_by"),
    input: text("input", { mode: "json" }).$type<unknown>(),
    output: text("output", { mode: "json" }).$type<unknown>(),
    error: text("error", { mode: "json" }).$type<{
      message: string;
      type: string;
      nodeId?: string;
      details?: unknown;
    }>(),
    resumeFrom: text("resume_from"),
    lockedAt: timestampNull("locked_at"),
    lockedBy: text("locked_by"),
    waitUntil: timestampNull("wait_until"),
    startedAt: timestampNull("started_at"),
    endedAt: timestampNull("ended_at"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("executions_org_created_idx").on(t.organizationId, t.createdAt),
    index("executions_workflow_idx").on(t.workflowId),
    index("executions_status_idx").on(t.status),
    index("executions_wait_idx").on(t.status, t.waitUntil),
  ],
);

export const executionReceipts = sqliteTable(
  "execution_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    root: text("root").notNull(),
    payloadJson: text("payload_json", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    chainId: text("chain_id"),
    txHash: text("tx_hash"),
    blockNumber: text("block_number"),
    contractAddress: text("contract_address"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at"),
    verifiedAt: timestampNull("verified_at"),
  },
  (t) => [
    uniqueIndex("execution_receipts_exec_seq_idx").on(t.executionId, t.sequence),
    index("execution_receipts_org_idx").on(t.organizationId),
    index("execution_receipts_exec_idx").on(t.executionId),
    index("execution_receipts_status_idx").on(t.status),
  ],
);

export const executionSteps = sqliteTable(
  "execution_steps",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    nodeType: text("node_type").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(1),
    input: text("input", { mode: "json" }).$type<unknown>(),
    output: text("output", { mode: "json" }).$type<unknown>(),
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>(),
    error: text("error", { mode: "json" }).$type<{
      message: string;
      type: string;
      details?: unknown;
    }>(),
    logs: text("logs", { mode: "json" })
      .$type<Array<{ ts: string; level: string; message: string; data?: unknown }>>()
      .notNull()
      .default(sql`'[]'`),
    startedAt: timestampNull("started_at"),
    endedAt: timestampNull("ended_at"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("execution_steps_run_idx").on(t.executionId),
    index("execution_steps_node_idx").on(t.executionId, t.nodeId),
  ],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    stepId: text("step_id")
      .notNull()
      .references(() => executionSteps.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    status: text("status").notNull().default("pending"),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    payload: text("payload", { mode: "json" }).$type<unknown>(),
    comment: text("comment"),
    timeoutAt: timestampNull("timeout_at"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestampNull("resolved_at"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("approvals_org_status_idx").on(t.organizationId, t.status),
    index("approvals_execution_idx").on(t.executionId),
  ],
);

export const integrations = sqliteTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("disconnected"),
    config: text("config", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [index("integrations_org_idx").on(t.organizationId)],
);

export const secrets = sqliteTable(
  "secrets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    lastFour: text("last_four").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [uniqueIndex("secrets_org_name_idx").on(t.organizationId, t.name)],
);

export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    definition: text("definition", { mode: "json" }).notNull().$type<{
      name: string;
      description?: string;
      graph: {
        nodes: Array<{
          id: string;
          type: string;
          name: string;
          position: { x: number; y: number };
          config: Record<string, unknown>;
          disabled?: boolean;
        }>;
        edges: Array<{
          id: string;
          source: string;
          target: string;
          sourceHandle?: string;
          targetHandle?: string;
          label?: string;
        }>;
      };
    }>(),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("templates_slug_idx").on(t.slug)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("audit_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_action_idx").on(t.action),
  ],
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    quantity: integer("quantity").notNull().default(1),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("usage_org_kind_idx").on(t.organizationId, t.kind),
    index("usage_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

export const schema = {
  users,
  organizations,
  memberships,
  projects,
  workflows,
  workflowVersions,
  workflowNodes,
  workflowEdges,
  executions,
  executionReceipts,
  executionSteps,
  approvals,
  integrations,
  secrets,
  templates,
  auditLogs,
  usageEvents,
};
