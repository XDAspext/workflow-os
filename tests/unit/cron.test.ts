import { describe, expect, it } from "vitest";
import { cronMatches, nextCron } from "@/domain/cron";

describe("cron", () => {
  it("matches weekday mornings", () => {
    const mondayNine = new Date(Date.UTC(2026, 7, 24, 9, 0, 0)); // Monday
    expect(cronMatches("0 9 * * 1-5", mondayNine)).toBe(true);
    expect(cronMatches("0 9 * * 1-5", new Date(Date.UTC(2026, 7, 23, 9, 0, 0)))).toBe(false);
  });

  it("finds the next weekday 09:00 UTC", () => {
    const sunday = new Date(Date.UTC(2026, 7, 23, 10, 0, 0));
    const next = nextCron("0 9 * * 1-5", sunday);
    expect(next?.toISOString()).toBe("2026-08-24T09:00:00.000Z");
  });
});
