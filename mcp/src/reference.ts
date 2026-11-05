/**
 * @file reference.ts
 * @description Embedded Eagle1 status reference exposed as an MCP resource.
 *
 * The map is duplicated from metadata/status-codes.jsonc so the MCP server can
 * run without read access to the repository. mcp/tests/reference_test.ts fails
 * if the two drift apart.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import type { McpServer } from "@modelcontextprotocol/server";

/** Eagle1 standardized event status codes. */
export const STATUS_CODES: Readonly<Record<number, string>> = {
  3000: "Transport Bill Created",
  3001: "Logistics In-Progress",
  3002: "Arrived, In-Transit",
  3003: "Scanned, In-Transit",
  3004: "Departed, In-Transit",
  3005: "Information Received",
  3006: "Information Processed",
  3009: "Process Stopped",
  3050: "Picked Up",
  3100: "Received by Carrier",
  3150: "Export Customs Clearance In-Progress",
  3200: "Export Customs Cleared",
  3250: "In-Transit to Destination",
  3300: "Arrived at Destination",
  3350: "Import Customs Clearance In-Progress",
  3400: "Import Customs Cleared",
  3450: "Final Delivery In-Progress",
  3500: "Delivered",
};

/** Eagle1 exception codes attached to events. */
export const EXCEPTION_CODES: Readonly<Record<number, string>> = {
  900: "Exception Occurred",
  901: "Cancelled",
  902: "Damaged",
  903: "Delayed",
  904: "Denied",
  905: "Incorrect Information",
  906: "Lost",
  907: "Recipient Not Available",
  908: "Refused by Recipient",
  909: "Rerouted",
  910: "Returned",
};

export const STATUS_CODES_RESOURCE_URI = "whereis://reference/status-codes";

/** Serializes the reference document. */
export function referenceDocument(): string {
  return JSON.stringify(
    { statusCodes: STATUS_CODES, exceptionCodes: EXCEPTION_CODES },
    null,
    2,
  );
}

/** Registers the reference resource on the MCP server. */
export function registerResources(server: McpServer): void {
  server.registerResource(
    "status-codes",
    STATUS_CODES_RESOURCE_URI,
    {
      title: "Eagle1 status codes",
      description:
        "Eagle1 standardized shipment status codes (3000-3500) and exception codes (900-910).",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: referenceDocument(),
      }],
    }),
  );
}
