import { NextResponse } from "next/server";
import { databaseUrl, ensureMigrated, pingDatabase } from "@/db/client";
import { isPostgresUrl } from "@/server/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureMigrated();
    await pingDatabase();
    return NextResponse.json({
      ok: true,
      service: "workflow-os",
      db: isPostgresUrl(databaseUrl()) ? "postgres" : "sqlite",
    });
  } catch {
    return NextResponse.json({ ok: false, service: "workflow-os" }, { status: 503 });
  }
}
