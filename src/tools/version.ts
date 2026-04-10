/**
 * @file version.ts
 * @description A command-line tool to display the application's version.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { logger, whereIsAPI } from "./logger.ts";
import { loadEnv } from "../main/app.ts";
import {AppError} from "../main/model.ts";

async function main(): Promise<void> {
  // step 1: load environment variable first
  await loadEnv();

  // step 2: Print the application version
  const appVersion = Deno.env.get("APP_VERSION");
  if (!appVersion) {
      throw new AppError("500-01",`ERR-VER-A: Missing APP_VERSION`);
  }
  console.log(`whereis-api ${appVersion}`);

  Deno.exit(0);
}

// Execute the main function and handle any uncaught errors
main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${whereIsAPI("exception")} Failed to start tool: ${message}`);
    Deno.exit(1);
});
