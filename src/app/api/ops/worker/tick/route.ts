import { NextResponse } from "next/server";
import { toErrorResponse } from "@/server/errors";
import { tickWorkerDetailed } from "@/server/worker";
import { authorizeWorkerRequest } from "@/server/worker-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  try {
    authorizeWorkerRequest(request);
    const result = await tickWorkerDetailed();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
