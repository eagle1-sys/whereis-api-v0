/**
 * @file mount_test.ts
 * @description Tests the `/mcp` endpoint mounted on a host Hono app.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { Hono } from "hono";
import { assert, assertEquals } from "@std/assert";
import type { McpConfig } from "../src/config.ts";
import { mountMcp, type MountMcpOptions } from "../src/mount.ts";
import { createMockBackend, SAMPLE_TRACK } from "./mock-backend.ts";
import { makeConfig } from "./test-config.ts";

const MCP_HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
};

function listTools(id = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" });
}

function callTool(
  name: string,
  args: Record<string, unknown>,
  id = 2,
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

interface Harness {
  app: Hono;
  configs: McpConfig[];
}

function mount(overrides: Partial<MountMcpOptions> = {}): Harness {
  const configs: McpConfig[] = [];
  const app = new Hono();

  mountMcp(app, {
    config: makeConfig(),
    createBackend: (config) => {
      configs.push(config);
      return createMockBackend();
    },
    ...overrides,
  });

  return { app, configs };
}

Deno.test("mounts next to the host app's own routes", async () => {
  const { app } = mount();
  app.get("/v0/operators", (c) => c.json({ ok: true }));

  const operators = await app.request("http://localhost:8037/v0/operators");
  assertEquals(operators.status, 200);

  const response = await app.request("http://localhost:8037/mcp", {
    method: "POST",
    headers: MCP_HEADERS,
    body: listTools(),
  });

  assertEquals(response.status, 200);
  const text = await response.text();
  assert(text.includes("list_operators"));
  assert(text.includes("track_shipment"));
});

Deno.test("serves anonymous callers without an API key", async () => {
  const { app, configs } = mount();

  const response = await app.request("http://localhost:8037/mcp", {
    method: "POST",
    headers: MCP_HEADERS,
    body: callTool("list_operators", {}),
  });

  assertEquals(response.status, 200);
  assertEquals(configs.length, 1);
  assertEquals(configs[0].apiKey, undefined);
});

Deno.test("forwards the caller's API key to the backend", async () => {
  const { app, configs } = mount({
    authenticate: (token) => token === "caller-key",
  });

  const response = await app.request("http://localhost:8037/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, Authorization: "Bearer caller-key" },
    body: callTool("track_shipment", { tracking_id: SAMPLE_TRACK.id }),
  });

  assertEquals(response.status, 200);
  assertEquals(configs.length, 1);
  assertEquals(configs[0].apiKey, "caller-key");

  const text = await response.text();
  assert(text.includes("Delivered"));
});

Deno.test("rejects a key the host does not recognise", async () => {
  const { app, configs } = mount({
    authenticate: (token) => token === "caller-key",
  });

  const response = await app.request("http://localhost:8037/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, Authorization: "Bearer wrong-key" },
    body: listTools(),
  });

  assertEquals(response.status, 401);
  assert(response.headers.get("www-authenticate")?.includes("Bearer"));
  assertEquals(configs.length, 0);
});

Deno.test("rejects a malformed Authorization header", async () => {
  const { app } = mount();

  const response = await app.request("http://localhost:8037/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, Authorization: "Basic abc" },
    body: listTools(),
  });

  assertEquals(response.status, 401);
});

Deno.test("treats a failing authenticate hook as a rejection", async () => {
  const { app } = mount({
    authenticate: () => {
      throw new Error("database unavailable");
    },
  });

  const response = await app.request("http://localhost:8037/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, Authorization: "Bearer any-key" },
    body: listTools(),
  });

  assertEquals(response.status, 401);
});

Deno.test("answers 400 for a malformed JSON body", async () => {
  const { app } = mount();

  const response = await app.request("http://localhost:8037/mcp", {
    method: "POST",
    headers: MCP_HEADERS,
    body: "{not json",
  });

  assertEquals(response.status, 400);
  assertEquals(await response.text(), "Invalid JSON");
});

Deno.test("honours a custom path and body limit", async () => {
  const { app } = mount({ path: "/mcp/v1", maxRequestBodySize: 16 });

  const tooLarge = await app.request("http://localhost:8037/mcp/v1", {
    method: "POST",
    headers: MCP_HEADERS,
    body: listTools(),
  });
  assertEquals(tooLarge.status, 413);

  const defaultPath = await app.request("http://localhost:8037/mcp", {
    method: "POST",
    headers: MCP_HEADERS,
    body: listTools(),
  });
  assertEquals(defaultPath.status, 404);
});
