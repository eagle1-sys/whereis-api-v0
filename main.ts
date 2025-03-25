/**
 * Main code to execute.
 * This module serves as the entry point for the application, handling environment loading,
 * metadata initialization, database setup, scheduling, and server startup.
 * @author samshdn
 * @version 0.1.1
 */
import { load } from "https://deno.land/std/dotenv/mod.ts";
import { logger } from "./logger.ts";
import { loadJSONFromFs } from "./util.ts";
import { initializeDbPool } from "./database/dbutil.ts";
// import { startScheduler } from "./schedule.ts";
import { Server } from "./server.ts";
import { syncRoutes } from "./schedule.ts";
import { CodeDesc, ErrorRegistry } from "./model.ts";

/**
 * Loads environment variables from a `.env` file and sets them in `Deno.env`.
 * @async
 * @returns {Promise<void>} A promise that resolves when the environment variables are loaded and set.
 * @throws {Error} If the `.env` file cannot be loaded or parsed.
 */
async function loadEnv(): Promise<void> {
  const env = await load({ envPath: "./.env" });
  for (const [key, value] of Object.entries(env)) {
    // set environment variable to Deno.env
    Deno.env.set(key, value);
  }
}

/**
 * Loads metadata from the file system, including status codes and error definitions.
 * Initializes the `CodeDesc` and `ErrorRegistry` classes with the loaded data.
 * @async
 * @returns {Promise<void>} A promise that resolves when the metadata is loaded and initialized.
 * @throws {Error} If the JSON files cannot be loaded or parsed.
 */
async function loadMetaData(): Promise<void> {
  const status: Record<string, any> = await loadJSONFromFs(
    "./metadata/codes.json",
  );
  CodeDesc.initialize(status);
  const errors: Record<string, any> = await loadJSONFromFs(
    "./metadata/errors.json",
  );
  ErrorRegistry.initialize(errors);
}

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
  await loadMetaData(); // load file system data
  initializeDbPool(); // initialize database connection pool

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
