/**
 * @file server.ts
 * @description Builds a fully configured MCP server instance.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { McpServer } from "@modelcontextprotocol/server";
import type { McpConfig } from "./config.ts";
import { registerResources } from "./reference.ts";
import { registerTools } from "./tools.ts";
import { SERVER_NAME, SERVER_VERSION } from "./version.ts";
import type { WhereisBackend } from "./whereis-client.ts";

/** Literal instructions added to the host's system prompt. */
export const SERVER_INSTRUCTIONS =
  "Eagle1 Whereis tracks shipments across carriers. A tracking ID is `<operator>-<tracking_number>`, for example `fdx-888877776666`. If you do not know the operator code, call list_operators first. SF Express (`sfex`) requires the last four digits of the recipient's phone (phone_last4) for every lookup. Use get_latest_status for “where is my package” questions and track_shipment for full history or delivery proof. Timestamps are ISO 8601 with the carrier's UTC offset; do not convert them unless asked. Status codes use Eagle1's 3000–3500 scale; read the `whereis://reference/status-codes` resource only when an event description needs clarification.";

/** Dependencies needed to build a server. */
export interface ServerDeps {
  backend: WhereisBackend;
  config: McpConfig;
}

/** Creates a fresh MCP server; the factory runs once per connection/request. */
export function createMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTools(server, deps.backend, deps.config);
  registerResources(server);

  return server;
}
