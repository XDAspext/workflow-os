import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  cancelExecution,
  enqueueExecution,
  expireTimedOutApprovals,
  retryExecution,
  runPersistedExecution,
} from "@/server/services/executions";
import { enqueueDueSchedules } from "@/server/services/schedules";
import { createWorkflow, publishWorkflow } from "@/server/services/workflows";
import { ensureMigrated, resetDbCache } from "@/db/client";
import { hashPassword } from "@/server/crypto";
import { id } from "@/domain/ids";
import { ConflictError } from "@/domain/permissions";
import { approvals, executions, memberships, organizations, projects, users } from "@/db/schema";
import { eq } from "drizzle-orm";

const dbFile = "./data/workflow-os-test.db";

describe("execution persistence", () => {
  let orgId = "";
  let userId = "";
  let workflowId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = `file:${dbFile}`;
    process.env.SEED_ON_BOOT = "false";
    resetDbCache();
    fs.rmSync(dbFile, { force: true });
    fs.rmSync(`${dbFile}-wal`, { force: true });
    fs.rmSync(`${dbFile}-shm`, { force: true });
    const db = await ensureMigrated();
    userId = id("user");
    orgId = id("org");
    const projectId = id("project");
    await db.insert(users).values({
      id: userId,
      email: "ops@example.com",
      name: "Ops",
      passwordHash: hashPassword("password-password"),
    });
    await db.insert(organizations).values({ id: orgId, name: "Example", slug: "example", plan: "pro" });
    await db.insert(memberships).values({
      id: id("membership"),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await db.insert(projects).values({
      id: projectId,
      organizationId: orgId,
      name: "Core",
      slug: "core",
    });
    workflowId = await createWorkflow({
      orgId,
      userId,
      projectId,
      name: "Echo",
      graph: {
        nodes: [
          { id: "t", type: "manual.trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
          {
            id: "out",
            type: "output.response",
            name: "Return",
            position: { x: 200, y: 0 },
            config: { value: "{{trigger.hello}}" },
          },
        ],
        edges: [{ id: "e", source: "t", target: "out" }],
      },
    });
    await publishWorkflow(orgId, userId, workflowId);
  });

  afterAll(() => {
    resetDbCache();
  });

  it("creates, runs, and stores a successful execution", async () => {
    const executionId = await enqueueExecution({
      orgId,
      userId,
      workflowId,
      triggerType: "manual",
      payload: { hello: "world" },
      version: "published",
    });
    await runPersistedExecution(executionId);
    const db = await ensureMigrated();
    const run = await db.query.executions.findFirst({
      where: (t, { eq }) => eq(t.id, executionId),
    });
    expect(run?.status).toBe("success");
    expect(run?.output).toBe("world");
  });

  it("cancels a queued run and refuses to retry a running run", async () => {
    const executionId = await enqueueExecution({
      orgId,
      userId,
      workflowId,
      triggerType: "manual",
      payload: { hello: "cancel-me" },
      version: "published",
    });
    await cancelExecution({ orgId, userId, executionId });
    const db = await ensureMigrated();
    const cancelled = await db.query.executions.findFirst({
      where: (t, { eq: equals }) => equals(t.id, executionId),
    });
    expect(cancelled?.status).toBe("cancelled");

    const runningId = await enqueueExecution({
      orgId,
      userId,
      workflowId,
      triggerType: "manual",
      payload: { hello: "running" },
      version: "published",
    });
    await db
      .update(executions)
      .set({ status: "running", lockedAt: new Date(), lockedBy: "test" })
      .where(eq(executions.id, runningId));
    await expect(retryExecution({ orgId, executionId: runningId })).rejects.toBeInstanceOf(ConflictError);
  });

  it("expires a pending approval past its timeout", async () => {
    const approvalWorkflowId = await createWorkflow({
      orgId,
      userId,
      name: "Needs a person",
      graph: {
        nodes: [
          { id: "t", type: "manual.trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
          {
            id: "ap",
            type: "human.approval",
            name: "Approve",
            position: { x: 160, y: 0 },
            config: { title: "Go?" },
          },
        ],
        edges: [{ id: "e", source: "t", target: "ap" }],
      },
    });
    await publishWorkflow(orgId, userId, approvalWorkflowId);
    const executionId = await enqueueExecution({
      orgId,
      userId,
      workflowId: approvalWorkflowId,
      triggerType: "manual",
      payload: {},
      version: "published",
    });
    await runPersistedExecution(executionId);
    const db = await ensureMigrated();
    const pending = await db.query.approvals.findFirst({
      where: (t, { eq: equals }) => equals(t.executionId, executionId),
    });
    expect(pending?.status).toBe("pending");
    await db
      .update(approvals)
      .set({ timeoutAt: new Date(Date.now() - 1000) })
      .where(eq(approvals.id, pending!.id));
    expect(await expireTimedOutApprovals()).toBe(1);
    const run = await db.query.executions.findFirst({
      where: (t, { eq: equals }) => equals(t.id, executionId),
    });
    expect(run?.status).toBe("timed_out");
  });

  it("enqueues a published schedule trigger at most once per minute", async () => {
    const scheduledId = await createWorkflow({
      orgId,
      userId,
      name: "Morning digest",
      graph: {
        nodes: [
          {
            id: "t",
            type: "schedule.trigger",
            name: "Cron",
            position: { x: 0, y: 0 },
            config: { cron: "0 9 * * 1-5" },
          },
          {
            id: "out",
            type: "output.response",
            name: "Return",
            position: { x: 200, y: 0 },
            config: { value: "{{trigger.cron}}" },
          },
        ],
        edges: [{ id: "e", source: "t", target: "out" }],
      },
    });
    await publishWorkflow(orgId, userId, scheduledId);
    const mondayNine = new Date(Date.UTC(2026, 7, 24, 9, 0, 0));
    const first = await enqueueDueSchedules(mondayNine);
    const second = await enqueueDueSchedules(mondayNine);
    expect(first).toBe(1);
    expect(second).toBe(0);
    const db = await ensureMigrated();
    const runs = await db.query.executions.findMany({
      where: (t, { eq: equals }) => equals(t.workflowId, scheduledId),
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.triggerType).toBe("schedule");
  });
});
