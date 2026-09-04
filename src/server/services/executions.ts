import { and, desc, eq, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { ensureMigrated, getPgSql } from "@/db/client";
import { approvals, executionSteps, executions, secrets, usageEvents, workflowVersions, workflows } from "@/db/schema";
import { id } from "@/domain/ids";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/permissions";
import { runWorkflow } from "@/domain/engine/run";
import { resumeWorkflow } from "@/domain/engine/resume";
import { decryptSecret } from "@/server/crypto";
import { writeAudit } from "@/server/audit";
import { validateGraph } from "@/domain/workflow/validate";
import type { EngineStepResult } from "@/domain/engine/types";
import {
  executeInlineOnEnqueue,
  publicAppUrl,
  workerConcurrency,
  workerLockTimeoutMs,
} from "@/server/config";

const ACTIVE_RUN = new Set(["queued", "running", "waiting"]);
const RETRYABLE = new Set(["failed", "cancelled", "timed_out", "success", "waiting"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function branchFromUnknown(value: unknown): string | undefined {
  const record = asRecord(value);
  return typeof record?.branch === "string" ? record.branch : undefined;
}

function errorPayload(error: unknown, nodeId?: string): { message: string; type: string; nodeId?: string } {
  const message = error instanceof Error ? error.message : String(error);
  const type = error instanceof Error ? error.name : "Error";
  return nodeId ? { message, type, nodeId } : { message, type };
}

export async function enqueueExecution(input: {
  orgId: string;
  userId?: string | null;
  workflowId: string;
  triggerType: string;
  payload: unknown;
  version?: "draft" | "published";
}) {
  const db = await ensureMigrated();
  const workflow = await db.query.workflows.findFirst({
    where: and(eq(workflows.id, input.workflowId), eq(workflows.organizationId, input.orgId)),
  });
  if (!workflow) throw new NotFoundError("Workflow not found");
  if (workflow.status === "paused" && input.triggerType !== "test" && input.triggerType !== "manual") {
    throw new ValidationError("This workflow is paused. New trigger events are not started.");
  }
  if (workflow.status === "archived") {
    throw new ValidationError("Archived workflows cannot run.");
  }
  const version =
    input.version === "draft" || !workflow.publishedVersionId
      ? await db.query.workflowVersions.findFirst({
          where: eq(workflowVersions.workflowId, workflow.id),
          orderBy: [desc(workflowVersions.version)],
        })
      : await db.query.workflowVersions.findFirst({
          where: eq(workflowVersions.id, workflow.publishedVersionId),
        });
  if (!version) throw new NotFoundError("Workflow version not found");
  const validation = validateGraph(version.definition.graph);
  if (!validation.ok) {
    throw new ValidationError("Cannot execute a workflow with validation errors.", validation.issues);
  }
  const executionId = id("execution");
  await db.insert(executions).values({
    id: executionId,
    organizationId: input.orgId,
    workflowId: workflow.id,
    workflowVersionId: version.id,
    status: "queued",
    triggerType: input.triggerType,
    triggeredBy: input.userId ?? null,
    input: input.payload,
  });
  await db.insert(usageEvents).values({
    id: id("usage"),
    organizationId: input.orgId,
    kind: "execution",
    quantity: 1,
    metadata: { workflowId: workflow.id },
  });
  await writeAudit({
    organizationId: input.orgId,
    userId: input.userId,
    action: "workflow.executed",
    resourceType: "execution",
    resourceId: executionId,
    metadata: { workflowId: workflow.id, triggerType: input.triggerType },
  });
  return executionId;
}

async function reclaimStaleLocks(): Promise<void> {
  const db = await ensureMigrated();
  const cutoff = new Date(Date.now() - workerLockTimeoutMs());
  await db
    .update(executions)
    .set({ status: "queued", lockedAt: null, lockedBy: null })
    .where(and(eq(executions.status, "running"), lt(executions.lockedAt, cutoff)));
}

async function claimDueExecutions(limit: number, workerId: string, now: Date): Promise<string[]> {
  const pg = getPgSql();
  if (pg) {
    const rows = await pg<{ id: string }[]>`
      UPDATE executions
      SET
        status = 'running',
        locked_at = ${now},
        locked_by = ${workerId},
        started_at = COALESCE(started_at, ${now})
      WHERE id IN (
        SELECT id FROM executions
        WHERE status = 'queued'
           OR (status = 'waiting' AND wait_until IS NOT NULL AND wait_until <= ${now})
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;
    return rows.map((row) => row.id);
  }

  const db = await ensureMigrated();
  const queued = await db.query.executions.findMany({
    where: eq(executions.status, "queued"),
    orderBy: [executions.createdAt],
    limit,
  });
  const delayed = await db.query.executions.findMany({
    where: and(
      eq(executions.status, "waiting"),
      isNotNull(executions.waitUntil),
      lte(executions.waitUntil, now),
    ),
    orderBy: [executions.createdAt],
    limit,
  });
  const ids: string[] = [];
  for (const row of [...queued, ...delayed]) {
    if (ids.length >= limit) break;
    const claimed = await db
      .update(executions)
      .set({ status: "running", lockedAt: now, lockedBy: workerId, startedAt: row.startedAt ?? now })
      .where(and(eq(executions.id, row.id), or(eq(executions.status, "queued"), eq(executions.status, "waiting"))))
      .returning({ id: executions.id });
    if (claimed[0]) ids.push(claimed[0].id);
  }
  return ids;
}

export async function processQueuedExecutions(limit = workerConcurrency()): Promise<number> {
  const batch = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 16) : workerConcurrency();
  await reclaimStaleLocks();
  const workerId = `worker-${process.pid}`;
  const claimed = await claimDueExecutions(batch, workerId, new Date());
  if (claimed.length === 0) return 0;
  const results = await Promise.allSettled(claimed.map((executionId) => runPersistedExecution(executionId)));
  return results.filter((result) => result.status === "fulfilled").length;
}

export function kickExecution(executionId: string): void {
  if (!executeInlineOnEnqueue()) return;
  void runPersistedExecution(executionId);
}

async function failRunningExecution(executionId: string, error: unknown): Promise<void> {
  const db = await ensureMigrated();
  const execution = await db.query.executions.findFirst({ where: eq(executions.id, executionId) });
  const ended = new Date();
  await db
    .update(executions)
    .set({
      status: "failed",
      error: errorPayload(error),
      endedAt: ended,
      durationMs: execution?.startedAt ? ended.getTime() - execution.startedAt.getTime() : null,
      lockedAt: null,
      lockedBy: null,
    })
    .where(and(eq(executions.id, executionId), eq(executions.status, "running")));
}

export async function runPersistedExecution(executionId: string): Promise<void> {
  try {
    await executeClaimedRun(executionId);
  } catch (error) {
    console.error("[execution]", executionId, error);
    await failRunningExecution(executionId, error);
  }
}

async function executeClaimedRun(executionId: string): Promise<void> {
  const db = await ensureMigrated();
  let execution = await db.query.executions.findFirst({ where: eq(executions.id, executionId) });
  if (!execution) return;
  if (execution.status === "queued" || execution.status === "waiting") {
    const now = new Date();
    const claimed = await db
      .update(executions)
      .set({
        status: "running",
        lockedAt: now,
        lockedBy: `inline-${process.pid}`,
        startedAt: execution.startedAt ?? now,
      })
      .where(
        and(
          eq(executions.id, executionId),
          or(eq(executions.status, "queued"), eq(executions.status, "waiting")),
        ),
      )
      .returning({ id: executions.id });
    if (claimed.length === 0) return;
    execution = await db.query.executions.findFirst({ where: eq(executions.id, executionId) });
    if (!execution) return;
  }
  if (execution.status !== "running") return;
  const version = await db.query.workflowVersions.findFirst({
    where: eq(workflowVersions.id, execution.workflowVersionId),
  });
  if (!version) {
    await failRunningExecution(executionId, new Error("Workflow version not found"));
    return;
  }

  const orgSecrets = await db.query.secrets.findMany({
    where: eq(secrets.organizationId, execution.organizationId),
  });
  const secretMap = new Map(orgSecrets.map((s) => [s.name, decryptSecret(s.encryptedValue)]));

  const existingSteps = await db.query.executionSteps.findMany({
    where: eq(executionSteps.executionId, execution.id),
  });
  const previousOutputs: Record<string, unknown> = {};
  for (const step of existingSteps) {
    if (step.status === "success" && step.nodeId !== execution.resumeFrom) {
      previousOutputs[step.nodeId] = step.output;
    }
  }

  const persistStep = async (step: EngineStepResult) => {
    const existing = existingSteps.find((s) => s.nodeId === step.nodeId && s.status !== "success");
    const row = {
      status: step.status,
      attempt: step.attempt,
      input: step.input,
      output: step.output,
      config: step.config,
      error: step.error,
      logs: step.logs,
      startedAt: new Date(step.startedAt),
      endedAt: step.endedAt ? new Date(step.endedAt) : null,
      durationMs: step.durationMs ?? null,
    };
    if (existing) {
      await db.update(executionSteps).set(row).where(eq(executionSteps.id, existing.id));
    } else {
      const stepId = id("step");
      await db.insert(executionSteps).values({
        id: stepId,
        executionId: execution.id,
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        name: step.name,
        ...row,
      });
      existingSteps.push({
        id: stepId,
        executionId: execution.id,
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        name: step.name,
        ...row,
        createdAt: new Date(),
      } as (typeof existingSteps)[number]);
      if (step.pause?.kind === "approval" || step.pause?.kind === "review") {
        await db.insert(approvals).values({
          id: id("approval"),
          organizationId: execution.organizationId,
          executionId: execution.id,
          stepId,
          nodeId: step.nodeId,
          status: "pending",
          title: step.pause.title ?? "Approval required",
          summary: step.pause.summary ?? "",
          payload: step.pause.payload ?? step.input,
          timeoutAt: step.pause.until ? new Date(step.pause.until) : null,
        });
      }
    }
  };

  const engineEnv = { APP_URL: publicAppUrl() };
  const resumeOutput = previousOutputs[execution.resumeFrom ?? ""] ?? execution.output;
  const result = execution.resumeFrom
    ? await resumeWorkflow({
        graph: version.definition.graph,
        trigger: execution.input,
        previousOutputs,
        env: engineEnv,
        decision: {
          nodeId: execution.resumeFrom,
          output: resumeOutput,
          branch: branchFromUnknown(execution.output) ?? branchFromUnknown(resumeOutput),
        },
        hooks: {
          secrets: async (name) => secretMap.get(name) ?? null,
          recordUsage: async (kind, quantity, metadata) => {
            await db.insert(usageEvents).values({
              id: id("usage"),
              organizationId: execution.organizationId,
              kind,
              quantity,
              metadata,
            });
          },
          onStep: persistStep,
        },
      })
    : await runWorkflow({
        graph: version.definition.graph,
        trigger: execution.input,
        env: engineEnv,
        hooks: {
          secrets: async (name) => secretMap.get(name) ?? null,
          recordUsage: async (kind, quantity, metadata) => {
            await db.insert(usageEvents).values({
              id: id("usage"),
              organizationId: execution.organizationId,
              kind,
              quantity,
              metadata,
            });
          },
          onStep: persistStep,
        },
      });

  const ended = new Date();
  const written = await db
    .update(executions)
    .set({
      status: result.status,
      output: result.output,
      error: result.error,
      resumeFrom: result.resumeFrom ?? null,
      waitUntil: result.waitUntil ? new Date(result.waitUntil) : null,
      endedAt: result.status === "waiting" ? null : ended,
      durationMs: execution.startedAt ? ended.getTime() - execution.startedAt.getTime() : null,
      lockedAt: null,
      lockedBy: null,
    })
    .where(and(eq(executions.id, execution.id), eq(executions.status, "running")))
    .returning({ id: executions.id });

  if (written.length === 0) return;

  if (result.status !== "waiting") {
    try {
      const { createReceiptForExecution } = await import("@/server/services/receipts");
      await createReceiptForExecution(execution.id);
    } catch (error) {
      console.error("[receipts]", error);
    }
  }
}

export async function decideApproval(input: {
  orgId: string;
  userId: string;
  approvalId: string;
  decision: "approve" | "reject" | "request_changes";
  comment?: string;
}) {
  const db = await ensureMigrated();
  const approval = await db.query.approvals.findFirst({
    where: and(eq(approvals.id, input.approvalId), eq(approvals.organizationId, input.orgId)),
  });
  if (!approval) throw new NotFoundError("Approval not found");
  if (approval.status !== "pending") throw new ValidationError("This approval is already resolved");
  const status =
    input.decision === "approve"
      ? "approved"
      : input.decision === "reject"
        ? "rejected"
        : "changes_requested";
  const branch =
    input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "changes";
  const output = {
    decision: input.decision,
    comment: input.comment ?? null,
    resolvedBy: input.userId,
    branch,
  };
  await db
    .update(approvals)
    .set({
      status,
      comment: input.comment ?? null,
      resolvedBy: input.userId,
      resolvedAt: new Date(),
    })
    .where(eq(approvals.id, approval.id));
  await db
    .update(executionSteps)
    .set({
      status: "success",
      output,
      endedAt: new Date(),
    })
    .where(eq(executionSteps.id, approval.stepId));
  await db
    .update(executions)
    .set({
      status: "queued",
      resumeFrom: approval.nodeId,
      output,
      waitUntil: null,
      lockedAt: null,
      lockedBy: null,
    })
    .where(eq(executions.id, approval.executionId));
  await writeAudit({
    organizationId: input.orgId,
    userId: input.userId,
    action: "approval.decided",
    resourceType: "approval",
    resourceId: approval.id,
    metadata: { decision: input.decision },
  });
  return approval.executionId;
}

export async function cancelExecution(input: {
  orgId: string;
  userId: string;
  executionId: string;
}): Promise<void> {
  const db = await ensureMigrated();
  const run = await db.query.executions.findFirst({
    where: and(eq(executions.id, input.executionId), eq(executions.organizationId, input.orgId)),
  });
  if (!run) throw new NotFoundError("Execution not found");
  if (!ACTIVE_RUN.has(run.status)) {
    throw new ValidationError("Only queued, running, or waiting runs can be cancelled.");
  }
  const ended = new Date();
  const cancelled = await db
    .update(executions)
    .set({
      status: "cancelled",
      error: { message: "Cancelled by operator", type: "Cancelled" },
      endedAt: ended,
      durationMs: run.startedAt ? ended.getTime() - run.startedAt.getTime() : null,
      lockedAt: null,
      lockedBy: null,
      waitUntil: null,
    })
    .where(and(eq(executions.id, run.id), or(eq(executions.status, "queued"), eq(executions.status, "running"), eq(executions.status, "waiting"))))
    .returning({ id: executions.id });
  if (cancelled.length === 0) {
    throw new ConflictError("This run already finished.");
  }
  await db
    .update(approvals)
    .set({ status: "cancelled", resolvedBy: input.userId, resolvedAt: ended, comment: "Run cancelled" })
    .where(and(eq(approvals.executionId, run.id), eq(approvals.status, "pending")));
  await writeAudit({
    organizationId: input.orgId,
    userId: input.userId,
    action: "execution.cancelled",
    resourceType: "execution",
    resourceId: run.id,
  });
}

export async function retryExecution(input: {
  orgId: string;
  executionId: string;
  fromNodeId?: string;
}): Promise<{ id: string; fromNodeId: string | null; status: "queued" }> {
  const db = await ensureMigrated();
  const run = await db.query.executions.findFirst({
    where: and(eq(executions.id, input.executionId), eq(executions.organizationId, input.orgId)),
  });
  if (!run) throw new NotFoundError("Execution not found");
  if (run.status === "running") {
    throw new ConflictError("This run is still executing. Cancel it first, then retry.");
  }
  if (run.status === "queued") {
    throw new ValidationError("This run is already queued.");
  }
  if (!RETRYABLE.has(run.status)) {
    throw new ValidationError("This run cannot be retried from its current state.");
  }
  const fromNodeId = input.fromNodeId ?? run.error?.nodeId ?? run.resumeFrom ?? undefined;
  if (fromNodeId) {
    await db
      .update(executionSteps)
      .set({ status: "pending", error: null, output: null, endedAt: null })
      .where(and(eq(executionSteps.executionId, run.id), eq(executionSteps.nodeId, fromNodeId)));
  }
  await db
    .update(executions)
    .set({
      status: "queued",
      error: null,
      resumeFrom: fromNodeId ?? null,
      waitUntil: null,
      lockedAt: null,
      lockedBy: null,
    })
    .where(eq(executions.id, run.id));
  return { id: run.id, fromNodeId: fromNodeId ?? null, status: "queued" };
}

export async function expireTimedOutApprovals(now = new Date()): Promise<number> {
  const db = await ensureMigrated();
  const due = await db.query.approvals.findMany({
    where: and(eq(approvals.status, "pending"), isNotNull(approvals.timeoutAt), lt(approvals.timeoutAt, now)),
    limit: 50,
  });
  let processed = 0;
  for (const approval of due) {
    const updated = await db
      .update(approvals)
      .set({ status: "timed_out", resolvedAt: now, comment: "Timed out" })
      .where(and(eq(approvals.id, approval.id), eq(approvals.status, "pending")))
      .returning({ id: approvals.id });
    if (updated.length === 0) continue;
    await db
      .update(executions)
      .set({
        status: "timed_out",
        error: { message: "Approval timed out", type: "TimeoutError", nodeId: approval.nodeId },
        endedAt: now,
        lockedAt: null,
        lockedBy: null,
        waitUntil: null,
      })
      .where(and(eq(executions.id, approval.executionId), eq(executions.status, "waiting")));
    processed += 1;
  }
  return processed;
}

export async function dashboardStats(orgId: string) {
  const db = await ensureMigrated();
  const [{ c: workflowCount } = { c: 0 }] = await db
    .select({ c: sql<number>`count(*)` })
    .from(workflows)
    .where(eq(workflows.organizationId, orgId));
  const [{ c: publishedCount } = { c: 0 }] = await db
    .select({ c: sql<number>`count(*)` })
    .from(workflows)
    .where(and(eq(workflows.organizationId, orgId), eq(workflows.status, "published")));
  const recent = await db.query.executions.findMany({
    where: eq(executions.organizationId, orgId),
    orderBy: [desc(executions.createdAt)],
    limit: 8,
  });
  const [{ c: failedCount } = { c: 0 }] = await db
    .select({ c: sql<number>`count(*)` })
    .from(executions)
    .where(and(eq(executions.organizationId, orgId), eq(executions.status, "failed")));
  const [{ c: runCount } = { c: 0 }] = await db
    .select({ c: sql<number>`count(*)` })
    .from(executions)
    .where(eq(executions.organizationId, orgId));
  const [{ c: tokenCount } = { c: 0 }] = await db
    .select({ c: sql<number>`coalesce(sum(quantity), 0)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.organizationId, orgId), eq(usageEvents.kind, "ai.tokens")));
  return {
    workflowCount: Number(workflowCount),
    publishedCount: Number(publishedCount),
    failedCount: Number(failedCount),
    runCount: Number(runCount),
    tokenCount: Number(tokenCount),
    recent,
  };
}
