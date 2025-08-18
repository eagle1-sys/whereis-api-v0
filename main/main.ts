/**
 * @file main.ts
 * @description This module serves as the entry point for the application, handling environment loading,
 * metadata initialization, database setup, scheduling, and server startup.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { app } from "./server.ts";
import { syncRoutes } from "./schedule.ts";
import { loadEnv, loadMetaData } from "./app.ts";
import { initConnection } from "../db/dbutil.ts";
import { getLogger  } from "../tools/logger.ts";

/**
 * Main entry point of the application.
 * Orchestrates the initialization of environment variables, metadata, database connections,
 * task scheduler, and starts the server.
 * @async
 * @returns {Promise<void>} A promise that resolves when the application is fully started.
 * @throws {Error} If any step in the initialization process fails.
 */
async function main(): Promise<void> {
  await loadEnv(); // load environment variable first

  // Initialize logger after environment is loaded
  const logger = getLogger();
  logger.info(`Starting application in ${Deno.env.get("APP_ENV")} mode`);

  await loadMetaData(); // load file system data
  await initConnection();

  /**
   * Starts a scheduler that periodically synchronizes tracking routes.
   * The task runs every 60 seconds using a cron job.
   */
  const intervalStr = Deno.env.get("APP_PULL_INTERVAL");
  const interval = intervalStr ? parseInt(intervalStr, 10) : 5;
  Deno.cron("Sync routes", { minute: { every: interval } }, () => {
    syncRoutes();
  }).then((_r) => {
    logger.info("The scheduler started.");
  });

}

// Execute the main function and handle any uncaught errors
main().catch((err) => {
  const logger = getLogger();
  logger.error("Failed to start application:", err);
  Deno.exit(1);
});

// Export the fetch handler for deno serve
export default {
  fetch: app.fetch,
} satisfies Deno.ServeDefaultExport;