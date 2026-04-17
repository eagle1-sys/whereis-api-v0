/**
 * @file version.ts
 * @description A command-line tool to display the application's version.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { logger, whereIsAPI } from "./logger.ts";

function main(): void {
  // Print the application version
  const appVersion = Deno.env.get("APP_VERSION") ?? "unknown";
  const appBuild = Deno.env.get("APP_BUILD") ?? "unknown";
  const appBuildDate = Deno.env.get("APP_BUILD_DATE") ?? "unknown";

  console.log(`whereis-api ${appVersion}; build ${appBuild}, ${appBuildDate}`);
  Deno.exit(0);
}

// Execute the main function and handle any uncaught errors
try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`${whereIsAPI("exception")} Failed to start tool: ${message}`);
  Deno.exit(1);
}
