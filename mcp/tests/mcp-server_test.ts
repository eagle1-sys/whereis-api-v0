/**
 * @file mcp-server_test.ts
 * @description End-to-end tool tests over an in-memory MCP transport.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { Client } from "@modelcontextprotocol/client";
import {
  InMemoryTransport,
  type McpServer,
} from "@modelcontextprotocol/server";
import { assert, assertEquals } from "@std/assert";
import { createMcpServer, SERVER_INSTRUCTIONS } from "../src/server.ts";
import { type McpConfig } from "../src/config.ts";
import {
  createMockBackend,
  SAMPLE_OPERATORS,
  SAMPLE_PUSH,
} from "./mock-backend.ts";
import { makeConfig } from "./test-config.ts";

interface Connected {
  server: McpServer;
  client: Client;
}

async function connect(config: McpConfig = makeConfig()): Promise<Connected> {
  const server = createMcpServer({
    backend: createMockBackend(),
    config,
  });
  const [clientTransport, serverTransport] = InMemoryTransport
    .createLinkedPair();

  await server.connect(serverTransport);

  const client = new Client({ name: "whereis-test", version: "0.0.0" });
  await client.connect(clientTransport);

  return { server, client };
}

async function disconnect(connected: Connected): Promise<void> {
  await connected.client.close();
  await connected.server.close();
}

function firstText(
  content: readonly { type: string; text?: string }[],
): string {
  const block = content.find((item) => item.type === "text");
  return block?.text ?? "";
}

Deno.test("advertises the read-only tools and instructions", async () => {
  const connected = await connect();
  try {
    const result = await connected.client.listTools();
    const names = result.tools.map((tool) => tool.name).sort();

    assertEquals(names, [
      "get_latest_status",
      "list_operators",
      "track_shipment",
    ]);

    for (const tool of result.tools) {
      assertEquals(tool.annotations?.readOnlyHint, true);
      assert(tool.outputSchema !== undefined);
    }

    assertEquals(connected.client.getInstructions(), SERVER_INSTRUCTIONS);
  } finally {
    await disconnect(connected);
  }
});

Deno.test("calls list_operators", async () => {
  const connected = await connect();
  try {
    const result = await connected.client.callTool({
      name: "list_operators",
      arguments: {},
    });

    assert(!result.isError);
    const text = firstText(result.content);
    assert(text.includes("- fdx: FedEx (active)"));
    assertEquals(result.structuredContent, { operators: SAMPLE_OPERATORS });
  } finally {
    await disconnect(connected);
  }
});

Deno.test("returns the latest status", async () => {
  const connected = await connect();
  try {
    const result = await connected.client.callTool({
      name: "get_latest_status",
      arguments: { tracking_id: "fdx-888877776666" },
    });

    assert(!result.isError);
    const text = firstText(result.content);
    assert(text.includes("3500 Delivered"));
    assertEquals(
      (result.structuredContent as { id?: string } | undefined)?.id,
      "fdx-888877776666",
    );
  } finally {
    await disconnect(connected);
  }
});

Deno.test("reports a missing SF Express phone as a tool error", async () => {
  const connected = await connect();
  try {
    const result = await connected.client.callTool({
      name: "get_latest_status",
      arguments: { tracking_id: "sfex-SF1234123412341" },
    });

    assertEquals(result.isError, true);
    assert(firstText(result.content).includes("phone_last4"));
  } finally {
    await disconnect(connected);
  }
});

Deno.test("returns a tracking timeline", async () => {
  const connected = await connect();
  try {
    const result = await connected.client.callTool({
      name: "track_shipment",
      arguments: {
        tracking_id: "fdx-888877776666",
        refresh: true,
      },
    });

    assert(!result.isError);
    const text = firstText(result.content);
    assert(
      text.includes(
        "Route: San Francisco CA United States -> CENTRAL Hong Kong SAR, China (cross-border)",
      ),
    );
    assert(text.includes("3000 Transport Bill Created"));
    assert(text.includes("3500 Delivered"));

    const structured = result.structuredContent as {
      id?: string;
      eventCount?: number;
    };
    assertEquals(structured.id, "fdx-888877776666");
    assertEquals(structured.eventCount, 2);
  } finally {
    await disconnect(connected);
  }
});

Deno.test("reads the status-code resource", async () => {
  const connected = await connect();
  try {
    const result = await connected.client.readResource({
      uri: "whereis://reference/status-codes",
    });

    assertEquals(result.contents.length, 1);
    const content = result.contents[0];
    assertEquals(content.mimeType, "application/json");
    assert("text" in content && content.text.includes('"3500"'));
    assert("text" in content && content.text.includes("Delivered"));
  } finally {
    await disconnect(connected);
  }
});

Deno.test("does not register the write tool by default", async () => {
  const connected = await connect();
  try {
    const result = await connected.client.listTools();
    assert(!result.tools.some((tool) => tool.name === "push_tracking_events"));
  } finally {
    await disconnect(connected);
  }
});

Deno.test("registers and calls the write tool when enabled", async () => {
  const connected = await connect(makeConfig({ enableWrite: true }));
  try {
    const tools = await connected.client.listTools();
    assert(tools.tools.some((tool) => tool.name === "push_tracking_events"));

    const result = await connected.client.callTool({
      name: "push_tracking_events",
      arguments: {
        events: [{
          trackingNum: "ACME11112222",
          status: 3000,
          what: "Transport Bill Created",
          whom: "ACME Logistics",
          when: "2024-11-11T14:16:48-06:00",
          where: "New York, NY",
        }],
      },
    });

    assert(!result.isError);
    assert(firstText(result.content).includes("Received 2 events"));
    assertEquals(result.structuredContent, SAMPLE_PUSH);
  } finally {
    await disconnect(connected);
  }
});
