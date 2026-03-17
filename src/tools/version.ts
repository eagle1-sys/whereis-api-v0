/**
 * @file version.ts
 * @description A command-line tool to display the application's version and build date.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { logger, whereIsAPI } from "./logger.ts";
import { loadEnv } from "../main/app.ts";

async function main(): Promise<void> {
  // step 1: load environment variable first
  await loadEnv();

  // step 2: Print the application version & build date
  const appVersion = Deno.env.get("APP_VERSION");
  const buildDate = Deno.env.get("BUILD_DATE");
  if (!appVersion || !buildDate) {
    throw new Error("Missing APP_VERSION or BUILD_DATE");
  }
  console.log(`whereis-api ${appVersion} build on ${buildDate}`);

  Deno.exit(0);
}

// Execute the main function and handle any uncaught errors
main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${whereIsAPI("exception")} Failed to start tool: ${message}`);
    Deno.exit(1);
});
