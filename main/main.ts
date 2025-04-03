/**
 * @file main.ts
 * @description This module serves as the entry point for the application, handling environment loading,
 * metadata initialization, database setup, scheduling, and server startup.
 */
import { logger } from "../tools/logger.ts";
import { initializeDbPool } from "../db/dbutil.ts";
import { Server } from "./server.ts";
import { syncRoutes } from "./schedule.ts";
import { loadEnv, loadMetaData } from "./app.ts";

/**
 * Main entry point of the application.
 * Orchestrates the initialization of environment variables, metadata, database connections,
 * task scheduler, and starts the server.
 * @async
 * @returns {Promise<void>} A promise that resolves when the application is fully started.
 * @throws {Error} If any step in the initialization process fails.
 */
async function main(): Promise<void> {
  await loadEnv();        // load environment variable first
  await loadMetaData();   // load file system data
  initializeDbPool();     // initialize database connection pool

  /**
   * Starts a scheduler that periodically synchronizes tracking routes.
   * The task runs every 60 seconds using a cron job.
   */
  Deno.cron("Sync routes", { minute: { every: 1 } }, () => {
    syncRoutes();
  }).then((_r) => {
    logger.info("The scheduler started.");
  });

  const portNo = Deno.env.get("PORT");
  const server = new Server(Number(portNo));
  server.start();
  logger.info(`server started on port ${portNo}`);
}

// Execute the main function and handle any uncaught errors
main().catch((err) => console.error("Failed to start application:", err));
