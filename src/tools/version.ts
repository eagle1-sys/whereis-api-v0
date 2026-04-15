/**
 * @file version.ts
 * @description A command-line tool to display the application's version.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { logger, whereIsAPI } from "./logger.ts";

function main(): Promise<void> {
  // step 2: Print the application version
  const appVersion = Deno.env.get("APP_VERSION");
  const appBuild = Deno.env.get("APP_BUILD");
  const appbuilddate = Deno.env.get("APP_BUILD_DATE");

  console.log(`whereis-api ${appVersion}, ${appBuild}, build on ${appbuilddate}`);
  Deno.exit(0);
}

// Execute the main function and handle any uncaught errors
main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`${whereIsAPI("exception")} Failed to start tool: ${message}`);
  Deno.exit(1);
});
