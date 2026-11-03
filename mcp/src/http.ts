/**
 * @file http.ts
 * @description Streamable HTTP entrypoint for the Whereis MCP server.
 *
 * The HTTP transport is intended for self-hosting or remote use. It refuses to
 * bind a non-loopback address without a bearer token and an allowed-host list.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { loadConfig, type McpConfig } from "./config.ts";
import { WhereisError } from "./errors.ts";
import { errorMessage, log, setLogLevel } from "./log.ts";
import { createMcpServer } from "./server.ts";
import { SERVER_NAME, SERVER_VERSION } from "./version.ts";
import { HttpWhereisBackend, type WhereisBackend } from "./whereis-client.ts";

const BEARER_PREFIX = "Bearer ";

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index++) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function isAuthorized(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) return false;
  return timingSafeEqual(header.slice(BEARER_PREFIX.length), token);
}

/**
 * Builds the Hono app served by the HTTP transport. Exported separately from
 * the listener so tests can exercise it with `app.request` without a port.
 */
export function createHttpApp(config: McpConfig, backend: WhereisBackend) {
  const handler = createMcpHandler(() => createMcpServer({ backend, config }));

  const app = createMcpHonoApp({
    host: config.http.host,
    allowedHosts: config.http.allowedHosts,
  });

  app.get("/healthz", (c) => c.text("ok"));

  app.use("/mcp", async (c, next) => {
    const expected = config.http.authToken;
    if (expected === undefined || expected.length === 0) {
      await next();
      return;
    }

    if (!isAuthorized(c.req.header("Authorization"), expected)) {
      c.header("WWW-Authenticate", 'Bearer realm="whereis-mcp"');
      return c.text("Unauthorized", 401);
    }

    await next();
  });

  app.all("/mcp", (c) => {
    const variables = c as unknown as { get(key: string): unknown };
    const parsedBody = variables.get("parsedBody");
    return handler.fetch(c.req.raw, { parsedBody });
  });

  return app;
}

async function main(): Promise<void> {
  const config = await loadConfig("http");
  setLogLevel(config.logLevel);

  const backend = new HttpWhereisBackend(config);
  const app = createHttpApp(config, backend);

  if (config.apiKey === undefined) {
    log.warn(
      "WHEREIS_API_KEY is not configured; track_shipment will fail. list_operators and get_latest_status still work.",
    );
  }

  log.info(
    `${SERVER_NAME} MCP server ${SERVER_VERSION} (http); api=${config.apiUrl}; apiKeyConfigured=${
      config.apiKey !== undefined
    }`,
  );
  log.info(
    `listening on http://${config.http.host}:${config.http.port}/mcp (health: /healthz)`,
  );

  Deno.serve(
    { hostname: config.http.host, port: config.http.port },
    app.fetch,
  );
}

if (import.meta.main) {
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
}
