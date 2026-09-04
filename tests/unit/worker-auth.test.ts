import { afterEach, describe, expect, it } from "vitest";
import { AuthenticationError } from "@/domain/permissions";
import { authorizeWorkerRequest } from "@/server/worker-auth";

const keys = ["WORKER_SECRET", "CRON_SECRET"] as const;

describe("worker tick auth", () => {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it("allows unsigned ticks outside production when no secret is set", () => {
    delete process.env.WORKER_SECRET;
    delete process.env.CRON_SECRET;
    expect(() => authorizeWorkerRequest(new Request("http://localhost/api/ops/worker/tick"))).not.toThrow();
  });

  it("requires a matching bearer token when a secret is configured", () => {
    process.env.WORKER_SECRET = "tick-secret-tick-secret-tick-secret";
    expect(() => authorizeWorkerRequest(new Request("http://localhost/api/ops/worker/tick"))).toThrow(
      AuthenticationError,
    );
    const request = new Request("http://localhost/api/ops/worker/tick", {
      headers: { authorization: "Bearer tick-secret-tick-secret-tick-secret" },
    });
    expect(() => authorizeWorkerRequest(request)).not.toThrow();
  });
});
