/**
 * @file http_test.ts
 * @description Tests the Hono HTTP transport without binding a port.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { assert, assertEquals } from "@std/assert";
import { createHttpApp } from "../src/http.ts";
import { createMockBackend } from "./mock-backend.ts";
import { makeConfig } from "./test-config.ts";

const MCP_REQUEST = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
});

const MCP_HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
  "Host": "127.0.0.1:8038",
};

function appWithToken() {
  return createHttpApp(
    makeConfig({
      http: { host: "127.0.0.1", port: 8038, authToken: "secret-token" },
    }),
    createMockBackend(),
  );
}

Deno.test("healthz responds without authentication", async () => {
  const app = createHttpApp(makeConfig(), createMockBackend());
  const response = await app.request("http://127.0.0.1:8038/healthz", {
    headers: { Host: "127.0.0.1:8038" },
  });

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
});

Deno.test("rejects /mcp without a bearer token when configured", async () => {
  const response = await appWithToken().request(
    "http://127.0.0.1:8038/mcp",
    { method: "POST", headers: MCP_HEADERS, body: MCP_REQUEST },
  );

  assertEquals(response.status, 401);
  assert(response.headers.get("www-authenticate")?.includes("Bearer"));
});

Deno.test("rejects /mcp with the wrong bearer token", async () => {
  const response = await appWithToken().request(
    "http://127.0.0.1:8038/mcp",
    {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: "Bearer wrong" },
      body: MCP_REQUEST,
    },
  );

  assertEquals(response.status, 401);
});

Deno.test("serves tools/list with a valid bearer token", async () => {
  const response = await appWithToken().request(
    "http://127.0.0.1:8038/mcp",
    {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: "Bearer secret-token" },
      body: MCP_REQUEST,
    },
  );

  assertEquals(response.status, 200);
  assert(response.headers.get("content-type")?.includes("text/event-stream"));

  const text = await response.text();
  assert(text.includes("event: message"));
  assert(text.includes("list_operators"));
});

Deno.test("allows /mcp when no token is configured", async () => {
  const app = createHttpApp(makeConfig(), createMockBackend());
  const response = await app.request(
    "http://127.0.0.1:8038/mcp",
    { method: "POST", headers: MCP_HEADERS, body: MCP_REQUEST },
  );

  assertEquals(response.status, 200);
  assert((await response.text()).includes("track_shipment"));
});
