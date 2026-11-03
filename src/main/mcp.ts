/**
 * @file mcp.ts
 * @description Mounts the Whereis MCP endpoint on the API server.
 *
 * The endpoint shares the API's port, TLS termination and CORS policy, so no
 * extra container or reverse proxy is needed: `/mcp` is served next to `/v0/*`.
 * Each request is authenticated with a Whereis API key and runs the tools as
 * that caller; requests without a key keep the public status lookup.
 *
 * Set `MCP_ENABLED=false` to leave the endpoint unmounted.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import type { Hono } from "hono";
import { loadConfig, type McpConfig } from "../../mcp/src/config.ts";
import { mountMcp } from "../../mcp/src/mount.ts";
import { getDbClient } from "../db/dbutil.ts";
import { logger, whereIsAPI } from "../tools/logger.ts";

const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

/** Reads `MCP_ENABLED`, defaulting to enabled. */
export function isMcpEnabled(): boolean {
  const raw = (Deno.env.get("MCP_ENABLED") ?? "true").trim().toLowerCase();
  return !DISABLED_VALUES.has(raw);
}

/**
 * Mounts `/mcp` on the API app.
 *
 * A configuration error disables the endpoint and leaves the REST API serving,
 * because a broken MCP config must not take the whole API down.
 */
export async function mountMcpEndpoint(app: Hono): Promise<boolean> {
  if (!isMcpEnabled()) {
    logger.info(
      `${whereIsAPI("startup")} MCP endpoint disabled by MCP_ENABLED.`,
    );
    return false;
  }

  let config: McpConfig;
  try {
    // "stdio" asks for transport-neutral config: the API owns host and port.
    config = await loadConfig("stdio");
  } catch (error) {
    logger.error(
      `${whereIsAPI("startup")} MCP endpoint not mounted: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }

  mountMcp(app, {
    config,
    authenticate: (token) => getDbClient().isTokenValid(token),
  });

  logger.info(
    `${
      whereIsAPI("startup")
    } MCP endpoint mounted at /mcp; api=${config.apiUrl}.`,
  );
  return true;
}
