/**
 * @file main.ts
 * @description Orchestrates the Eagle1 Whereis API app by spawning:
 * - API server process (with parallel request handling enabled)
 * - Background scheduler process (handles periodic tasks such as auto-pulling tracking data from logistics providers)
 *
 * Handles graceful shutdown and restarts the scheduler if it exits unexpectedly.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { logger } from "../tools/logger.ts";

const port = Deno.env.get("PORT") || "8037";

const apiArgs = [
  "serve",
  "--parallel",
  "--port",
  port,
  "--allow-sys",
  "--allow-env",
  "--allow-net",
  "--allow-read",
  "--allow-write",
  "--allow-ffi",
  "src/main/api_server.ts",
];

const schedulerArgs = [
  "run",
  "--allow-sys",
  "--allow-env",
  "--allow-net",
  "--allow-read",
  "--allow-write",
  "--allow-ffi",
  "src/main/scheduler.ts",
];

function spawnApi(): Deno.ChildProcess {
  logger.info(`[main] Starting API process on port ${port}...`);

  const proc = new Deno.Command(Deno.execPath(), {
    args: apiArgs,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  logger.info(`[main] API process started.`);
  return proc;
}

function spawnScheduler(reason = "start"): Deno.ChildProcess {
  if (reason === "restart") {
    logger.info("[main] Restarting scheduler process...");
  } else {
    logger.info("[main] Starting scheduler process...");
  }

  const proc = new Deno.Command(Deno.execPath(), {
    args: schedulerArgs,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  logger.info("[main] Scheduler process started.");
  return proc;
}

const apiCmd = spawnApi();
let schedulerCmd = spawnScheduler();
let shuttingDown = false;

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("\n[main] Shutting down...");

  try {
    apiCmd.kill("SIGTERM");
  } catch {
    // already exited
  }

  try {
    schedulerCmd.kill("SIGTERM");
  } catch {
    // already exited
  }

  await Promise.allSettled([
    apiCmd.status,
    schedulerCmd.status,
  ]);

  logger.info("[main] Shutdown complete.");
  Deno.exit(0);
}

async function monitorAndRestartScheduler() {
  while (!shuttingDown) {
    const status = await schedulerCmd.status;

    if (status.success) {
      logger.info("[main] Scheduler exited normally, not restarting.");
      break;
    }

    logger.error(
      `[main] ==> Scheduler exited with code ${status.code}. Restarting in 5s...`,
    );

    await new Promise((resolve) => setTimeout(resolve, 5000));

    if (shuttingDown) break;

    schedulerCmd = spawnScheduler("restart");
  }
}

monitorAndRestartScheduler().catch((err) => {
  logger.error(`[main] Scheduler monitor failed: ${err}`);
  if (!shuttingDown) {
    Deno.exit(1);
  }
});

const apiStatus = await apiCmd.status;

if (!shuttingDown) {
  logger.error(`[main] API process exited with code ${apiStatus.code}, shutting down.`);
  await shutdown();
}
