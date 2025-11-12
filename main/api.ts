/**
 * @file api.ts
 * @description HTTP API server entry point for the Eagle1 Whereis API. This module initializes
 * and serves the RESTful API endpoints for shipment tracking across multiple logistics providers.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { app } from "./server.ts";
import {initializeOperatorStatus, loadEnv, loadMetaData} from "./app.ts";
import {initConnection} from "../db/dbutil.ts";
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

    initializeOperatorStatus(); // initialize operator status
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