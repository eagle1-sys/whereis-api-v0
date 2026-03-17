/**
 * @file version.ts
 * @description A command-line tool to display the application's version and build date.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import {logger, whereIsAPI} from "./logger.ts";
import {loadEnv} from "../main/app.ts";

async function main(): Promise<void> {
    // step 1: load environment variable first
    await loadEnv();

    // step 2: Print the application version & build date
    console.log(`whereis-api ${Deno.env.get("APP_VERSION")} build on ${Deno.env.get("BUILD_DATE")}`);

    Deno.exit(0);
}

// Execute the main function and handle any uncaught errors
main().catch((err) => {
    logger.error(`${whereIsAPI("exception")} Failed to start tool:${err}`);
    Deno.exit(1);
});