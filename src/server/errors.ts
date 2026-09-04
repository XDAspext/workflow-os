import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/domain/permissions";

export function toErrorResponse(error: unknown): NextResponse {
  unstable_rethrow(error);
  if (
    error instanceof AuthenticationError ||
    error instanceof AuthorizationError ||
    error instanceof NotFoundError ||
    error instanceof ValidationError ||
    error instanceof ConflictError ||
    error instanceof RateLimitError
  ) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.name,
        issues: error instanceof ValidationError ? error.issues : undefined,
      },
      { status: error.status },
    );
  }
  console.error(error);
  return NextResponse.json({ error: "Something went wrong. The action was not completed.", code: "InternalError" }, { status: 500 });
}

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

function pruneRateLimitBuckets(now: number): void {
  if (buckets.size < 512) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    buckets.clear();
  }
}

export function rateLimit(key: string, limit = 20, windowMs = 60_000): void {
  const now = Date.now();
  pruneRateLimitBuckets(now);
  const current = buckets.get(key);
  if (!current || current.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new RateLimitError();
}
