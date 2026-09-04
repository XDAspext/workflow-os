import { expireTimedOutApprovals, processQueuedExecutions } from "@/server/services/executions";
import { enqueueDueSchedules } from "@/server/services/schedules";
import { ensureMigrated } from "@/db/client";
import { isProduction, seedOnBootEnabled, workerConcurrency } from "@/server/config";
import { maybeSeed } from "@/server/seed";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let inFlight: Promise<number> | null = null;

export type WorkerTickResult = {
  processed: number;
  scheduled: number;
  expiredApprovals: number;
};

export async function tickWorker(): Promise<number> {
  const result = await tickWorkerDetailed();
  return result.processed;
}

export async function tickWorkerDetailed(): Promise<WorkerTickResult> {
  if (running) return { processed: 0, scheduled: 0, expiredApprovals: 0 };
  running = true;
  const work = (async (): Promise<WorkerTickResult> => {
    await ensureMigrated();
    if (seedOnBootEnabled()) await maybeSeed();
    const scheduled = await enqueueDueSchedules();
    const expiredApprovals = await expireTimedOutApprovals();
    const processed = await processQueuedExecutions(workerConcurrency());
    return { processed, scheduled, expiredApprovals };
  })();
  inFlight = work.then((result) => result.processed).catch(() => 0);
  try {
    return await work;
  } catch (error) {
    console.error("[worker]", error);
    return { processed: 0, scheduled: 0, expiredApprovals: 0 };
  } finally {
    running = false;
    inFlight = null;
  }
}

export function startWorker(): void {
  if (timer) return;
  const ms = Number(process.env.WORKER_POLL_MS ?? (isProduction() ? 1000 : 750));
  void tickWorker();
  timer = setInterval(() => {
    void tickWorker();
  }, Number.isFinite(ms) ? ms : 1000);
}

export async function stopWorker(graceMs = 25_000): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  if (!inFlight) return;
  await Promise.race([
    inFlight,
    new Promise<void>((resolve) => {
      setTimeout(resolve, graceMs);
    }),
  ]);
}
