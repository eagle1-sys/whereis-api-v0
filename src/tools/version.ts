/**
 * @file version.ts
 * @description A command-line tool to display the application's version.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { logger, whereIsAPI } from "./logger.ts";

/** The one version banner: the startup log and this tool both use it. */
export function versionBanner(): string {
  const appVersion = Deno.env.get("APP_VERSION") ?? "unknown";
  const appBuild = Deno.env.get("APP_BUILD") ?? "unknown";
  const appBuildDate = Deno.env.get("APP_BUILD_DATE") ?? "unknown";

  return `Whereis API ${appVersion}; build ${appBuild}, ${appBuildDate}`;
}

function main(): void {
  // Print the application version
  console.log(versionBanner());
  Deno.exit(0);
}

// Run only when this file is the entry point, so app.ts can import the banner
if (import.meta.main) {
  try {
    main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${whereIsAPI("exception")} Failed to start tool: ${message}`);
    Deno.exit(1);
  }
}
