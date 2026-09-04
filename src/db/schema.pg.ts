import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date());

const tsNull = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    avatarColor: text("avatar_color").notNull().default("#c96442"),
    onboardedAt: tsNull("onboarded_at"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    plan: text("plan").notNull().default("free"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [uniqueIndex("orgs_slug_idx").on(t.slug)],
);

export const memberships = pgTable(
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
    createdAt: ts("created_at"),
  },
  (t) => [
    uniqueIndex("memberships_org_user_idx").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("projects_org_slug_idx").on(t.organizationId, t.slug),
    index("projects_org_idx").on(t.organizationId),
  ],
);

export const workflows = pgTable(
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
    verifyOnChain: boolean("verify_on_chain").notNull().default(false),
    lastScheduledAt: tsNull("last_scheduled_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    index("workflows_org_idx").on(t.organizationId),
    index("workflows_project_idx").on(t.projectId),
    uniqueIndex("workflows_webhook_idx").on(t.webhookToken),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").notNull().$type<{
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
    publishedAt: tsNull("published_at"),
    createdAt: ts("created_at"),
  },
  (t) => [
    uniqueIndex("workflow_versions_wf_ver_idx").on(t.workflowId, t.version),
    index("workflow_versions_wf_idx").on(t.workflowId),
  ],
);

export const workflowNodes = pgTable(
  "workflow_nodes",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    config: jsonb("config").notNull().$type<Record<string, unknown>>(),
    positionX: integer("position_x").notNull().default(0),
    positionY: integer("position_y").notNull().default(0),
    disabled: boolean("disabled").notNull().default(false),
  },
  (t) => [
    uniqueIndex("workflow_nodes_version_key_idx").on(t.versionId, t.nodeKey),
    index("workflow_nodes_type_idx").on(t.type),
  ],
);

export const workflowEdges = pgTable(
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

export const executions = pgTable(
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
    input: jsonb("input").$type<unknown>(),
    output: jsonb("output").$type<unknown>(),
    error: jsonb("error").$type<{
      message: string;
      type: string;
      nodeId?: string;
      details?: unknown;
    }>(),
    resumeFrom: text("resume_from"),
    lockedAt: tsNull("locked_at"),
    lockedBy: text("locked_by"),
    waitUntil: tsNull("wait_until"),
    startedAt: tsNull("started_at"),
    endedAt: tsNull("ended_at"),
    durationMs: integer("duration_ms"),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("executions_org_created_idx").on(t.organizationId, t.createdAt),
    index("executions_workflow_idx").on(t.workflowId),
    index("executions_status_idx").on(t.status),
    index("executions_wait_idx").on(t.status, t.waitUntil),
  ],
);

export const executionReceipts = pgTable(
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
    payloadJson: jsonb("payload_json").notNull().$type<Record<string, unknown>>(),
    chainId: text("chain_id"),
    txHash: text("tx_hash"),
    blockNumber: text("block_number"),
    contractAddress: text("contract_address"),
    status: text("status").notNull().default("pending"),
    createdAt: ts("created_at"),
    verifiedAt: tsNull("verified_at"),
  },
  (t) => [
    uniqueIndex("execution_receipts_exec_seq_idx").on(t.executionId, t.sequence),
    index("execution_receipts_org_idx").on(t.organizationId),
    index("execution_receipts_exec_idx").on(t.executionId),
    index("execution_receipts_status_idx").on(t.status),
  ],
);

export const executionSteps = pgTable(
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
    input: jsonb("input").$type<unknown>(),
    output: jsonb("output").$type<unknown>(),
    config: jsonb("config").$type<Record<string, unknown>>(),
    error: jsonb("error").$type<{
      message: string;
      type: string;
      details?: unknown;
    }>(),
    logs: jsonb("logs")
      .$type<Array<{ ts: string; level: string; message: string; data?: unknown }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    startedAt: tsNull("started_at"),
    endedAt: tsNull("ended_at"),
    durationMs: integer("duration_ms"),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("execution_steps_run_idx").on(t.executionId),
    index("execution_steps_node_idx").on(t.executionId, t.nodeId),
  ],
);

export const approvals = pgTable(
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
    payload: jsonb("payload").$type<unknown>(),
    comment: text("comment"),
    timeoutAt: tsNull("timeout_at"),
    resolvedBy: text("resolved_by"),
    resolvedAt: tsNull("resolved_at"),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("approvals_org_status_idx").on(t.organizationId, t.status),
    index("approvals_execution_idx").on(t.executionId),
  ],
);

export const integrations = pgTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("disconnected"),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [index("integrations_org_idx").on(t.organizationId)],
);

export const secrets = pgTable(
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
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [uniqueIndex("secrets_org_name_idx").on(t.organizationId, t.name)],
);

export const templates = pgTable(
  "templates",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    definition: jsonb("definition").notNull().$type<{
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
    featured: boolean("featured").notNull().default(false),
    createdAt: ts("created_at"),
  },
  (t) => [uniqueIndex("templates_slug_idx").on(t.slug)],
);

export const auditLogs = pgTable(
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
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("audit_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_action_idx").on(t.action),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    quantity: integer("quantity").notNull().default(1),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: ts("created_at"),
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
