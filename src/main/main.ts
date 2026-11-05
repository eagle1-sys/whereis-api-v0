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

/**
 * The MCP transport tears a request down on `request.signal`, and Deno's legacy
 * semantics abort that signal as soon as a response is returned, which can cut a
 * server-sent event stream short. `--unstable-no-legacy-abort` opts into
 * aborting on a real disconnect instead.
 *
 * The flag is unstable, and a build without it refuses to start the child with
 * "unexpected argument". Probing the runtime keeps a pinned older Deno usable
 * instead of failing at child startup.
 * See https://docs.deno.com/go/unstable-no-legacy-abort.
 */
function supportsNoLegacyAbort(): boolean {
  try {
    const probe = new Deno.Command(Deno.execPath(), {
      args: ["serve", "--unstable-no-legacy-abort", "--help"],
      stdout: "null",
      stderr: "null",
    }).outputSync();
    return probe.success;
  } catch {
    return false;
  }
}

const noLegacyAbort = supportsNoLegacyAbort();

if (!noLegacyAbort) {
  logger.warn(
    "[main] This Deno build rejects --unstable-no-legacy-abort; the MCP endpoint will serve with legacy request.abort semantics.",
  );
}

const apiArgs = [
  "serve",
  "--parallel",
  ...(noLegacyAbort ? ["--unstable-no-legacy-abort"] : []),
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
  logger.info(`[main] Starting api-server process on port ${port}...`);

  const proc = new Deno.Command(Deno.execPath(), {
    args: apiArgs,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  logger.info(`[main] api-server process started.`);
  return proc;
}

const schedulerProcs = new Set<Deno.ChildProcess>();

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

  schedulerProcs.add(proc);
  proc.status.finally(() => {
    schedulerProcs.delete(proc);
  });

  logger.info("[main] scheduler process started.");
  return proc;
}

// Start two processes
const apiCmd = spawnApi();
let schedulerCmd = spawnScheduler();
let shuttingDown = false;

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  Deno.removeSignalListener("SIGINT", shutdown);
  Deno.removeSignalListener("SIGTERM", shutdown);

  logger.info("\n[main] Shutting down...");

  try {
    apiCmd.kill("SIGTERM");
  } catch {
    // already exited
  }

  for (const proc of schedulerProcs) {
    try {
      proc.kill("SIGTERM");
    } catch {
      // already exited
    }
  }

  await Promise.allSettled([
    apiCmd.status,
    ...Array.from(schedulerProcs, (proc) => proc.status),
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

await Promise.all([
  monitorAndRestartScheduler().catch((err) => {
    logger.error(`[main] Scheduler monitor failed: ${err}`);
    if (!shuttingDown) {
      Deno.exit(1);
    }
  }),
  (async () => {
    const apiStatus = await apiCmd.status;

    if (!shuttingDown) {
      logger.error(
        `[main] API process exited with code ${apiStatus.code}, shutting down.`,
      );
      await shutdown();
    }
  })(),
]);
