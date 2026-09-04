import { and, eq, isNull, lt, or } from "drizzle-orm";
import { ensureMigrated } from "@/db/client";
import { workflowVersions, workflows } from "@/db/schema";
import { cronMatches } from "@/domain/cron";
import { enqueueExecution } from "@/server/services/executions";

function startOfUtcMinute(date: Date): Date {
  const minute = new Date(date.getTime());
  minute.setUTCSeconds(0, 0);
  return minute;
}

function scheduleTriggerOf(definition: {
  graph: { nodes: Array<{ type: string; disabled?: boolean; config: Record<string, unknown> }> };
}) {
  return definition.graph.nodes.find((node) => node.type === "schedule.trigger" && !node.disabled);
}

export async function enqueueDueSchedules(now = new Date()): Promise<number> {
  const db = await ensureMigrated();
  const published = await db.query.workflows.findMany({
    where: eq(workflows.status, "published"),
  });
  const minute = startOfUtcMinute(now);
  let enqueued = 0;

  for (const workflow of published) {
    if (!workflow.publishedVersionId) continue;
    const version = await db.query.workflowVersions.findFirst({
      where: eq(workflowVersions.id, workflow.publishedVersionId),
    });
    if (!version) continue;
    const trigger = scheduleTriggerOf(version.definition);
    if (!trigger) continue;
    const cron = String(trigger.config.cron ?? "0 9 * * 1-5");
    if (!cronMatches(cron, now)) continue;
    if (workflow.lastScheduledAt && workflow.lastScheduledAt.getTime() >= minute.getTime()) continue;

    const claimed = await db
      .update(workflows)
      .set({ lastScheduledAt: now, updatedAt: now })
      .where(
        and(
          eq(workflows.id, workflow.id),
          eq(workflows.status, "published"),
          or(isNull(workflows.lastScheduledAt), lt(workflows.lastScheduledAt, minute)),
        ),
      )
      .returning({ id: workflows.id });
    if (claimed.length === 0) continue;

    try {
      await enqueueExecution({
        orgId: workflow.organizationId,
        workflowId: workflow.id,
        triggerType: "schedule",
        payload: { scheduledFor: now.toISOString(), cron, source: "schedule" },
        version: "published",
      });
      enqueued += 1;
    } catch (error) {
      console.error("[schedule]", workflow.id, error);
    }
  }

  return enqueued;
}
