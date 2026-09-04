import { NextResponse } from "next/server";
import { requirePermission } from "@/server/context";
import { toErrorResponse } from "@/server/errors";
import { cancelExecution } from "@/server/services/executions";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("executions.cancel");
    const { id } = await params;
    await cancelExecution({ orgId: ctx.org.id, userId: ctx.user.id, executionId: id });
    return NextResponse.json({ id, status: "cancelled" });
  } catch (error) {
    return toErrorResponse(error);
  }
}
