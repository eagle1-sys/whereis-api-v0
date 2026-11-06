/**
 * @file api_server.ts
 * @description HTTP API server entry point for the Eagle1 Whereis API. This module initializes
 * and serves the RESTful API endpoints for shipment tracking across multiple logistics providers.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { app } from "./server.ts";
import { initApp } from "./app.ts";
import { mountMcpEndpoint } from "./mcp.ts";
import { whereIsAPI, logger } from "../tools/logger.ts";

/**
 * Main entry point of the application.
 * Orchestrates the initialization of environment variables, metadata, database connections,
 * task scheduler, and starts the server.
 * @async
 * @returns {Promise<void>} A promise that resolves when the application is fully started.
 * @throws {Error} If any step in the initialization process fails.
 */
async function main(): Promise<void> {
    await initApp();
    mountMcpEndpoint(app);
}

// Start initialization once. `deno serve` accepts connections as soon as this
// module is imported, so the fetch handler waits for startup rather than letting
// a request reach an uninitialized database or an unmounted /mcp.
const startup = main();

startup.catch((err) => {
    logger.error(`${whereIsAPI("exception")} Failed to start application:${err}`);
    Deno.exit(1);
});

// Export the fetch handler for deno serve
export default {
    async fetch(request: Request): Promise<Response> {
        await startup;
        return await app.fetch(request);
    },
} satisfies Deno.ServeDefaultExport;
