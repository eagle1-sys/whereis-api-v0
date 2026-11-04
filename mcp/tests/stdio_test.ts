/**
 * @file stdio_test.ts
 * @description Spawns the real stdio entrypoint and verifies the JSON-RPC channel.
 *
 * stdout must contain only protocol messages; any console.log in the server
 * would break the first JSON.parse here.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { assert, assertEquals } from "@std/assert";

interface RpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: {
    content?: { type?: string; text?: string }[];
    structuredContent?: { operators?: { code?: string }[] };
  };
  error?: unknown;
}

function createMockApi(): Deno.HttpServer {
  return Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen: () => {} },
    (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v0/operators") {
        return Response.json({
          operators: [{ code: "fdx", name: "FedEx", active: true }],
        });
      }
      return Response.json(
        { error: "404-01", message: "No data available from carrier" },
        { status: 404 },
      );
    },
  );
}

Deno.test("serves JSON-RPC over stdio without polluting stdout", async () => {
  const api = createMockApi();
  const address = api.addr as Deno.NetAddr;
  assert(address.port > 0);

  const repoRoot = decodeURIComponent(
    new URL("../../", import.meta.url).pathname,
  );
  const env: Record<string, string> = {
    WHEREIS_API_URL: `http://127.0.0.1:${address.port}`,
    WHEREIS_API_KEY: "test-key",
    WHEREIS_ENV_FILE: "",
    MCP_LOG_LEVEL: "error",
  };
  const denoDir = Deno.env.get("DENO_DIR");
  if (denoDir !== undefined) env.DENO_DIR = denoDir;
  const home = Deno.env.get("HOME");
  if (home !== undefined) env.HOME = home;

  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env",
      "--allow-net",
      "--allow-read",
      "mcp/src/stdio.ts",
    ],
    cwd: repoRoot,
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  try {
    const writer = child.stdin.getWriter();
    const encoder = new TextEncoder();
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "stdio-test", version: "0.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_operators", arguments: {} },
      },
    ];

    for (const message of messages) {
      await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
    }

    // Keep stdin open long enough for the mock API round trip. Closing stdin
    // earlier aborts in-flight requests by design.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await writer.close();

    const output = await child.output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(
      output.code,
      0,
      `stdio server exited with ${output.code}: ${stderr}`,
    );

    const stdout = new TextDecoder().decode(output.stdout);
    const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
    assert(lines.length >= 3, `expected at least 3 responses, got: ${stdout}`);

    const byId = new Map<number | string, RpcResponse>();
    for (const line of lines) {
      const parsed = JSON.parse(line) as RpcResponse;
      assertEquals(parsed.jsonrpc, "2.0");
      if (parsed.id !== undefined && parsed.id !== null) {
        byId.set(parsed.id, parsed);
      }
    }

    assert(byId.has(1), "missing initialize response");
    assert(byId.has(2), "missing tools/list response");
    assert(byId.has(3), "missing tools/call response");

    const toolList = byId.get(2);
    assert(toolList?.result !== undefined);

    const call = byId.get(3);
    const text = call?.result?.content?.[0]?.text ?? "";
    assert(text.includes("fdx: FedEx"));
    assertEquals(
      call?.result?.structuredContent?.operators?.[0]?.code,
      "fdx",
    );
  } finally {
    try {
      child.kill("SIGTERM");
    } catch {
      // already exited
    }
    await api.shutdown();
  }
});
