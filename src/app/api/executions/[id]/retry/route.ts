import { NextResponse } from "next/server";
import { requirePermission } from "@/server/context";
import { toErrorResponse } from "@/server/errors";
import { kickExecution, retryExecution } from "@/server/services/executions";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("workflows.execute");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { fromNodeId?: string };
    const result = await retryExecution({
      orgId: ctx.org.id,
      executionId: id,
      fromNodeId: body.fromNodeId,
    });
    kickExecution(result.id);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
