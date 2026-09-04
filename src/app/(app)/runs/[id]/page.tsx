import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ensureMigrated } from "@/db/client";
import { executionSteps, executions, workflowVersions, workflows } from "@/db/schema";
import { requirePermission } from "@/server/context";
import { StatusBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/card";
import { formatDateTime, formatDuration } from "@/lib/format";
import { ExecutionInspector } from "@/components/execution/inspector";
import { explainFailure } from "@/domain/ops/failure";
import { latestReceipt } from "@/server/services/receipts";
import { VerificationPanel } from "@/components/verify/panel";
import { RunActions } from "@/components/execution/run-actions";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("executions.read");
  const { id } = await params;
  const db = await ensureMigrated();
  const run = await db.query.executions.findFirst({
    where: and(eq(executions.id, id), eq(executions.organizationId, ctx.org.id)),
  });
  if (!run) notFound();
  const steps = await db.query.executionSteps.findMany({ where: eq(executionSteps.executionId, run.id) });
  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, run.workflowId) });
  const version = await db.query.workflowVersions.findFirst({
    where: eq(workflowVersions.id, run.workflowVersionId),
  });
  const receipt = await latestReceipt(run.id, ctx.org.id);
  const failedStep = steps.find((s) => s.nodeId === run.error?.nodeId);
  const brief = run.error
    ? explainFailure({ error: run.error, nodeName: failedStep?.name, nodeType: failedStep?.nodeType })
    : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={workflow?.name ?? "Execution"}
        description={`${run.triggerType} · version locked · ${formatDateTime(run.createdAt)} · ${formatDuration(run.durationMs)}`}
        actions={
          <div className="flex items-center gap-2">
            <RunActions id={run.id} status={run.status} />
            <StatusBadge status={run.status} />
          </div>
        }
      />
      {run.error && brief ? (
        <div className="mt-4 rounded-[var(--radius)] border border-danger/40 bg-[var(--danger-bg)] px-4 py-3 text-sm">
          <p className="font-medium text-danger">{brief.what}</p>
          <p className="mt-1 text-muted">{brief.why}</p>
          <p className="mt-2 text-[13px]">{brief.recommended}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-[12px] text-faint">View technical details</summary>
            <p className="mt-1 font-mono text-[12px] text-muted">
              {run.error.message}
              {run.error.type ? ` · ${run.error.type}` : ""}
              {run.error.nodeId ? ` · ${run.error.nodeId}` : ""}
            </p>
          </details>
        </div>
      ) : null}
      <VerificationPanel
        executionId={run.id}
        receipt={
          receipt
            ? {
                id: receipt.id,
                sequence: receipt.sequence,
                root: receipt.root,
                status: receipt.status,
                chainId: receipt.chainId,
                txHash: receipt.txHash,
                blockNumber: receipt.blockNumber,
                contractAddress: receipt.contractAddress,
                createdAt: receipt.createdAt.toISOString(),
                verifiedAt: receipt.verifiedAt?.toISOString() ?? null,
              }
            : null
        }
      />
      <ExecutionInspector
        graph={version?.definition.graph ?? { nodes: [], edges: [] }}
        steps={steps.map((s) => ({
          nodeId: s.nodeId,
          name: s.name,
          type: s.nodeType,
          status: s.status,
          durationMs: s.durationMs,
          startedAt: s.startedAt,
          input: s.input,
          output: s.output,
          config: s.config,
          logs: s.logs,
          error: s.error,
        }))}
        runInput={run.input}
        runOutput={run.output}
        runStatus={run.status}
        executionId={run.id}
        startedAt={run.startedAt}
      />
    </div>
  );
}
