import { loadEnv } from "@/server/load-env";

loadEnv();

import { closeDb, ensureMigrated } from "@/db/client";
import { assertProductionConfig } from "@/server/config";
import { startWorker, stopWorker } from "@/server/worker";

async function main() {
  assertProductionConfig();

  if (process.argv.includes("--check")) {
    await ensureMigrated();
    console.info("FlowForge worker check ok");
    await closeDb();
    return;
  }

  startWorker();
  console.info("FlowForge worker polling for queued executions, schedules, and approval timeouts");

  let shuttingDown = false;
  function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`FlowForge worker received ${signal}, shutting down`);
    void stopWorker()
      .then(() => closeDb())
      .finally(() => process.exit(0));
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
