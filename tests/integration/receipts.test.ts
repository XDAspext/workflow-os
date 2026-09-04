import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { enqueueExecution, retryExecution, runPersistedExecution } from "@/server/services/executions";
import { createWorkflow, publishWorkflow, setWorkflowVerifyOnChain } from "@/server/services/workflows";
import { createReceiptForExecution, latestReceipt, verifyExecution } from "@/server/services/receipts";
import { ensureMigrated, resetDbCache } from "@/db/client";
import { hashPassword } from "@/server/crypto";
import { id } from "@/domain/ids";
import { executions, memberships, organizations, projects, users } from "@/db/schema";
import { eq } from "drizzle-orm";

const dbFile = "./data/workflow-os-receipt-test.db";

describe("execution receipts", () => {
  let orgId = "";
  let userId = "";
  let workflowId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = `file:${dbFile}`;
    process.env.SEED_ON_BOOT = "false";
    process.env.BLOCKCHAIN_ENABLED = "false";
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
      email: "receipts@example.com",
      name: "Receipts",
      passwordHash: hashPassword("password-password"),
    });
    await db.insert(organizations).values({ id: orgId, name: "Receipts", slug: "receipts", plan: "pro" });
    await db.insert(memberships).values({
      id: id("membership"),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await db.insert(projects).values({ id: projectId, organizationId: orgId, name: "Core", slug: "core" });
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
    process.env.BLOCKCHAIN_ENABLED = "false";
  });

  it("creates a local receipt for a terminal run when blockchain is disabled", async () => {
    const executionId = await enqueueExecution({
      orgId,
      userId,
      workflowId,
      triggerType: "manual",
      payload: { hello: "world" },
      version: "published",
    });
    await runPersistedExecution(executionId);
    const receipt = await latestReceipt(executionId, orgId);
    expect(receipt).toBeTruthy();
    expect(receipt?.sequence).toBe(1);
    expect(receipt?.root).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt?.status).toBe("pending");
    const verified = await verifyExecution(executionId, orgId, { audit: false });
    expect(verified.valid).toBe(true);
    expect(verified.outcome).toBe("integrity_verified");
  });

  it("detects tampering of the stored execution", async () => {
    const executionId = await enqueueExecution({
      orgId,
      userId,
      workflowId,
      triggerType: "manual",
      payload: { hello: "tamper" },
      version: "published",
    });
    await runPersistedExecution(executionId);
    const db = await ensureMigrated();
    await db.update(executions).set({ output: "mutated" }).where(eq(executions.id, executionId));
    const verified = await verifyExecution(executionId, orgId, { audit: false });
    expect(verified.valid).toBe(false);
    expect(verified.outcome).toBe("integrity_failed");
  });

  it("increments receipt sequence on retry instead of overwriting", async () => {
    const executionId = await enqueueExecution({
      orgId,
      userId,
      workflowId,
      triggerType: "manual",
      payload: { hello: "again" },
      version: "published",
    });
    await runPersistedExecution(executionId);
    const first = await latestReceipt(executionId, orgId);
    await retryExecution({ orgId, executionId });
    await runPersistedExecution(executionId);
    const second = await latestReceipt(executionId, orgId);
    expect(first?.sequence).toBe(1);
    expect(second?.sequence).toBe(2);
    expect(second?.root).not.toBe(first?.root);
  });

  it("anchors with the demo adapter when enabled", async () => {
    process.env.BLOCKCHAIN_ENABLED = "true";
    process.env.BLOCKCHAIN_MODE = "demo";
    await setWorkflowVerifyOnChain(orgId, userId, workflowId, true);
    const executionId = await enqueueExecution({
      orgId,
      userId,
      workflowId,
      triggerType: "manual",
      payload: { hello: "demo-chain" },
      version: "published",
    });
    await runPersistedExecution(executionId);
    const receipt = await latestReceipt(executionId, orgId);
    expect(receipt?.status).toBe("mocked");
    expect(receipt?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const verified = await verifyExecution(executionId, orgId, { audit: false });
    expect(verified.outcome).toBe("demo_verified");
    expect(verified.mocked).toBe(true);
    process.env.BLOCKCHAIN_ENABLED = "false";
  });

  it("does not fail the workflow if anchoring is skipped", async () => {
    const executionId = await enqueueExecution({
      orgId,
      userId,
      workflowId,
      triggerType: "test",
      payload: { hello: "test-run" },
      version: "published",
    });
    await runPersistedExecution(executionId);
    const db = await ensureMigrated();
    const run = await db.query.executions.findFirst({ where: eq(executions.id, executionId) });
    expect(run?.status).toBe("success");
    await createReceiptForExecution(executionId);
    expect(run?.status).toBe("success");
  });
});
