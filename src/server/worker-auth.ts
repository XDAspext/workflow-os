import { AuthenticationError } from "@/domain/permissions";
import { isProduction, workerSharedSecret } from "@/server/config";
import { secureCompare } from "@/server/crypto";

export function authorizeWorkerRequest(request: Request): void {
  const expected = workerSharedSecret();
  const header = request.headers.get("authorization") ?? request.headers.get("x-worker-secret") ?? "";
  const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header.trim();
  if (!expected) {
    if (isProduction()) {
      throw new AuthenticationError("WORKER_SECRET or CRON_SECRET must be configured");
    }
    return;
  }
  if (!provided || !secureCompare(provided, expected)) {
    throw new AuthenticationError("Invalid worker secret");
  }
}
