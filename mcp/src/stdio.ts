/**
 * @file stdio.ts
 * @description stdio entrypoint for the Whereis MCP server.
 *
 * stdout is the JSON-RPC channel. Every log line must go to stderr.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.ts";
import { WhereisError } from "./errors.ts";
import { errorMessage, log, setLogLevel } from "./log.ts";
import { createMcpServer } from "./server.ts";
import { SERVER_NAME, SERVER_VERSION } from "./version.ts";
import { HttpWhereisBackend } from "./whereis-client.ts";

async function main(): Promise<void> {
  const config = await loadConfig("stdio");
  setLogLevel(config.logLevel);

  const backend = new HttpWhereisBackend(config);

  log.info(
    `${SERVER_NAME} MCP server ${SERVER_VERSION} (stdio); api=${config.apiUrl}; apiKeyConfigured=${
      config.apiKey !== undefined
    }`,
  );

  if (config.apiKey === undefined) {
    log.warn(
      "WHEREIS_API_KEY is not configured; track_shipment will fail. list_operators and get_latest_status still work.",
    );
  }

  const handle = serveStdio(
    () => createMcpServer({ backend, config }),
    { onerror: (error) => log.error(`stdio: ${errorMessage(error)}`) },
  );

  const stop = (): void => {
    void handle.close().finally(() => Deno.exit(0));
  };

  Deno.addSignalListener("SIGINT", stop);
  Deno.addSignalListener("SIGTERM", stop);
}

try {
  await main();
} catch (error) {
  if (error instanceof WhereisError) {
    log.error(`${error.code}: ${error.message}`);
    log.error(`Hint: ${error.hint}`);
  } else {
    log.error(errorMessage(error));
  }
  Deno.exit(1);
}
