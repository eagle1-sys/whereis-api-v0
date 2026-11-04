/**
 * @file tools.ts
 * @description MCP tool definitions for shipment tracking.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { McpConfig } from "./config.ts";
import { toErrorResult } from "./errors.ts";
import {
  formatOperators,
  formatPush,
  formatStatus,
  formatTrack,
} from "./format.ts";
import { normalizeTrackingId } from "./tracking-id.ts";
import type { PushEventInput } from "./types.ts";
import type { WhereisBackend } from "./whereis-client.ts";

const trackingIdSchema = z.string().trim().min(1).describe(
  "Tracking ID in `<operator>-<tracking_number>` form, e.g. `fdx-888877776666` or `sfex-SF1234123412341`. Call list_operators if the carrier code is unknown.",
);

const phoneLast4Schema = z.union([z.string(), z.number().int()]).optional()
  .describe(
    "Last 4 digits of the recipient's phone number. Required for SF Express (`sfex`); omit for other carriers.",
  );

const pushEventSchema = z.object({
  trackingNum: z.string().min(1).describe(
    "Carrier tracking number without the operator prefix, e.g. `ACME11112222`.",
  ),
  status: z.number().int().describe(
    "Eagle1 standardized status code, e.g. 3000 for Transport Bill Created.",
  ),
  what: z.string().min(1).describe("Human-readable event description."),
  whom: z.string().min(1).describe("Party responsible for the event."),
  when: z.string().min(1).describe(
    "Event timestamp in ISO 8601 form, e.g. `2024-11-11T14:16:48-06:00`.",
  ),
  where: z.string().min(1).describe("Location description."),
  notes: z.string().optional().describe("Additional context for the event."),
});

const eventOutputSchema = z.object({
  status: z.number().int(),
  what: z.string(),
  whom: z.string().optional(),
  when: z.string().optional(),
  where: z.string().optional(),
  notes: z.string().optional(),
  trackingNum: z.string().optional(),
  dataProvider: z.string().optional(),
  updateMethod: z.string().optional(),
  updatedAt: z.string().optional(),
  exceptionCode: z.number().optional(),
  exceptionDesc: z.string().optional(),
  transitMode: z.string().optional(),
});

const trackOutputSchema = z.object({
  id: z.string(),
  operator: z.string(),
  trackingNumber: z.string(),
  type: z.string().optional(),
  uuid: z.string().optional(),
  createdAt: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  isCrossBorder: z.boolean().optional(),
  processingTimeMs: z.number().optional(),
  eventCount: z.number().int(),
  returnedEventCount: z.number().int(),
  truncated: z.boolean(),
  omittedEventCount: z.number().int(),
  events: z.array(eventOutputSchema),
});

const statusOutputSchema = z.object({
  id: z.string(),
  status: z.number().int(),
  what: z.string(),
  whom: z.string().optional(),
  when: z.string().optional(),
  where: z.string().optional(),
  notes: z.string().optional(),
});

const operatorsOutputSchema = z.object({
  operators: z.array(z.object({
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
  })),
});

const pushOutputSchema = z.object({
  eventsReceived: z.number().int(),
  eventsAdded: z.number().int(),
  eventsDuplicate: z.number().int(),
  createdTrackingIds: z.array(z.string()),
  updatedTrackingIds: z.array(z.string()),
  unchangedTrackingIds: z.array(z.string()),
  failedTrackingIds: z.array(z.string()),
});

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: true,
  idempotentHint: true,
} as const;

async function safeRun(
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    return toErrorResult(error);
  }
}

/** Registers every tool on the MCP server. */
export function registerTools(
  server: McpServer,
  backend: WhereisBackend,
  config: McpConfig,
): void {
  server.registerTool(
    "list_operators",
    {
      title: "List carriers",
      description:
        "List the carrier operator codes supported by Eagle1 Whereis (for example `fdx` = FedEx, `sfex` = SF Express). Call this before tracking when you only know the carrier name; the code is the prefix of every tracking ID. No API key is required.",
      inputSchema: z.object({}),
      outputSchema: operatorsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (_args, ctx) =>
      await safeRun(async () => {
        const operators = await backend.listOperators(ctx.mcpReq.signal);
        return {
          content: [{ type: "text", text: formatOperators(operators) }],
          structuredContent: { operators },
        };
      }),
  );

  server.registerTool(
    "get_latest_status",
    {
      title: "Get latest shipment status",
      description:
        "Return the current status and last known location of one shipment. Use this for “where is my package?” questions; it is the smallest response. It reads Eagle1’s stored latest event and does not force a carrier refresh; if the user needs the newest carrier data, call track_shipment with refresh=true. Requires a tracking ID; SF Express also requires phone_last4.",
      inputSchema: z.object({
        tracking_id: trackingIdSchema,
        phone_last4: phoneLast4Schema,
      }),
      outputSchema: statusOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, ctx) =>
      await safeRun(async () => {
        const trackingId = normalizeTrackingId(
          args.tracking_id,
          args.phone_last4,
        );
        const result = await backend.getLatestStatus({
          trackingId,
          signal: ctx.mcpReq.signal,
        });
        return {
          content: [{ type: "text", text: formatStatus(result) }],
          structuredContent: { ...result },
        };
      }),
  );

  server.registerTool(
    "track_shipment",
    {
      title: "Track shipment history",
      description:
        "Return a shipment’s full event timeline (oldest first) with standardized status codes, locations, and notes. Use when the user needs the history or delivery proof, or when the latest status looks stale. On first lookup Eagle1 may fetch from the carrier, which can take several seconds; refresh=true forces a carrier fetch. Requires a tracking ID; SF Express also requires phone_last4.",
      inputSchema: z.object({
        tracking_id: trackingIdSchema,
        phone_last4: phoneLast4Schema,
        refresh: z.boolean().default(false).describe(
          "Force a fresh pull from the carrier instead of returning Eagle1's stored history. Slower and may hit carrier rate limits; use only when the latest data matters.",
        ),
      }),
      outputSchema: trackOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, ctx) =>
      await safeRun(async () => {
        const trackingId = normalizeTrackingId(
          args.tracking_id,
          args.phone_last4,
        );
        const result = await backend.trackShipment({
          trackingId,
          refresh: args.refresh,
          signal: ctx.mcpReq.signal,
        });
        return {
          content: [{ type: "text", text: formatTrack(result) }],
          structuredContent: { ...result },
        };
      }),
  );

  if (config.enableWrite) {
    server.registerTool(
      "push_tracking_events",
      {
        title: "Push tracking events",
        description:
          "Write tracking events into Eagle1’s database for the `eg1` operator. This is a write operation: call it only when the user explicitly asks to import or push tracking data. Duplicate events are ignored. The operator is fixed to `eg1`; FedEx and SF Express do not support push.",
        inputSchema: z.object({
          events: z.array(pushEventSchema).min(1).max(100).describe(
            "Tracking events to push. Each event needs trackingNum, status, what, whom, when, and where.",
          ),
        }),
        outputSchema: pushOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async (args, ctx) =>
        await safeRun(async () => {
          const events: PushEventInput[] = args.events.map((event) => ({
            ...event,
          }));
          const result = await backend.pushEvents(events, ctx.mcpReq.signal);
          return {
            content: [{ type: "text", text: formatPush(result) }],
            structuredContent: { ...result },
            ...(result.failedTrackingIds.length > 0 ? { isError: true } : {}),
          };
        }),
    );
  }
}
