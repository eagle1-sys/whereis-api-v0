/**
 * @file format_test.ts
 * @description Unit tests for the model-visible text formats.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { assertEquals } from "@std/assert";
import {
  formatOperators,
  formatPush,
  formatStatus,
  formatTrack,
} from "../src/format.ts";
import type { TrackResult } from "../src/types.ts";
import {
  SAMPLE_OPERATORS,
  SAMPLE_PUSH,
  SAMPLE_STATUS,
  SAMPLE_TRACK,
} from "./mock-backend.ts";

Deno.test("formats a full tracking timeline", () => {
  assertEquals(
    formatTrack(SAMPLE_TRACK),
    [
      "fdx-888877776666 — 2 events; latest 3500 Delivered (2024-11-17T10:12:00-06:00)",
      "Route: San Francisco CA United States -> CENTRAL Hong Kong SAR, China (cross-border)",
      "1. 2024-11-11T14:16:48-06:00 | 3000 Transport Bill Created | FedEx | Customer location | Shipment information sent to FedEx",
      "2. 2024-11-17T10:12:00-06:00 | 3500 Delivered | FedEx | Front door",
    ].join("\n"),
  );
});

Deno.test("formats a shipment with no events", () => {
  const empty: TrackResult = {
    ...SAMPLE_TRACK,
    eventCount: 0,
    returnedEventCount: 0,
    events: [],
  };

  assertEquals(
    formatTrack(empty),
    [
      "fdx-888877776666 — 0 events",
      "Route: San Francisco CA United States -> CENTRAL Hong Kong SAR, China (cross-border)",
      "No events reported.",
    ].join("\n"),
  );
});

Deno.test("reports truncation without hiding the newest events", () => {
  const truncated: TrackResult = {
    ...SAMPLE_TRACK,
    eventCount: 5,
    returnedEventCount: 2,
    truncated: true,
    omittedEventCount: 3,
  };

  const text = formatTrack(truncated);
  assertEquals(
    text.endsWith(
      "… 3 earlier events omitted (showing the most recent 2). Set WHEREIS_MAX_EVENTS to raise the cap.",
    ),
    true,
  );
  assertEquals(text.includes("3500 Delivered"), true);
});

Deno.test("collapses whitespace inside event text", () => {
  const result: TrackResult = {
    ...SAMPLE_TRACK,
    events: [{
      status: 3000,
      what: "Transport   Bill\nCreated",
      whom: " FedEx ",
      when: "2024-11-11T14:16:48-06:00",
      where: "Customer\nlocation",
      notes: "  Shipment   information ",
    }],
    eventCount: 1,
    returnedEventCount: 1,
  };

  const text = formatTrack(result);
  assertEquals(text.includes("Transport Bill Created"), true);
  assertEquals(text.includes("Customer location"), true);
  assertEquals(text.includes("Shipment information"), true);
  assertEquals(text.includes("\n2."), false);
});

Deno.test("formats the latest status", () => {
  assertEquals(
    formatStatus(SAMPLE_STATUS),
    [
      "fdx-888877776666 — 3500 Delivered",
      "2024-11-17T10:12:00-06:00 | Front door | Signed by J. D.",
    ].join("\n"),
  );
});

Deno.test("formats the operator list", () => {
  assertEquals(
    formatOperators(SAMPLE_OPERATORS),
    [
      "- fdx: FedEx (active)",
      "- sfex: SF Express (active)",
      "- eg1: Eagle1 (active)",
    ].join("\n"),
  );
});

Deno.test("formats the push summary", () => {
  assertEquals(
    formatPush(SAMPLE_PUSH),
    [
      "Received 2 events: 1 added, 1 duplicate.",
      "Created: eg1-ACME11112222",
      "Unchanged: eg1-ACME33334444",
    ].join("\n"),
  );
});
