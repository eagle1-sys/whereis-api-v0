/**
 * @file tracking-id_test.ts
 * @description Unit tests for tracking ID validation.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { WhereisError } from "../src/errors.ts";
import { normalizeTrackingId } from "../src/tracking-id.ts";

function inputErrorFor(
  trackingId: string,
  phoneLast4?: string | number,
): WhereisError {
  const error = assertThrows(() => normalizeTrackingId(trackingId, phoneLast4));
  assert(error instanceof WhereisError);
  assertEquals(error.code, "INPUT");
  return error;
}

Deno.test("normalizes a FedEx tracking ID", () => {
  const result = normalizeTrackingId(" fdx-888877776666 ");
  assertEquals(result.operator, "fdx");
  assertEquals(result.trackingNumber, "888877776666");
  assertEquals(result.id, "fdx-888877776666");
  assertEquals(result.phoneLast4, undefined);
});

Deno.test("lowercases the operator but preserves the tracking number", () => {
  const result = normalizeTrackingId("FDX-888877776666");
  assertEquals(result.operator, "fdx");
  assertEquals(result.id, "fdx-888877776666");
});

Deno.test("normalizes an SF Express ID and phone number", () => {
  const result = normalizeTrackingId("sfex-sf1234123412341", 6993);
  assertEquals(result.operator, "sfex");
  assertEquals(result.trackingNumber, "SF1234123412341");
  assertEquals(result.phoneLast4, "6993");
  assertEquals(result.id, "sfex-SF1234123412341");
});

Deno.test("accepts an eg1 ID", () => {
  const result = normalizeTrackingId("eg1-ACME11112222");
  assertEquals(result.operator, "eg1");
  assertEquals(result.id, "eg1-ACME11112222");
});

Deno.test("rejects an empty tracking ID", () => {
  const error = inputErrorFor("   ");
  assert(error.message.includes("required"));
});

Deno.test("rejects a tracking ID without a hyphen", () => {
  const error = inputErrorFor("888877776666");
  assert(error.hint.includes("<operator>-<tracking_number>"));
});

Deno.test("rejects a tracking ID with extra hyphens", () => {
  const error = inputErrorFor("fdx-123-456");
  assert(error.hint.includes("exactly one hyphen"));
});

Deno.test("rejects spaces and slashes in a tracking ID", () => {
  inputErrorFor("fdx-123 456");
  inputErrorFor("fdx-123/456");
});

Deno.test("rejects an over-long FedEx tracking number", () => {
  const error = inputErrorFor(`fdx-${"9".repeat(26)}`);
  assert(error.message.includes("may not exceed"));
});

Deno.test("rejects SF Express without phone_last4", () => {
  const error = inputErrorFor("sfex-SF1234123412341");
  assert(error.message.includes("phone_last4"));
});

Deno.test("rejects a non-four-digit SF Express phone", () => {
  inputErrorFor("sfex-SF1234123412341", "699");
  inputErrorFor("sfex-SF1234123412341", "69933");
});

Deno.test("rejects an invalid SF Express tracking number", () => {
  inputErrorFor("sfex-SF123", "6993");
});

Deno.test("rejects phone_last4 for FedEx and eg1", () => {
  inputErrorFor("fdx-888877776666", "6993");
  inputErrorFor("eg1-ACME11112222", "6993");
});

Deno.test("allows an unknown operator and leaves validation to the API", () => {
  const result = normalizeTrackingId("zzz-123456");
  assertEquals(result.operator, "zzz");
  assertEquals(result.id, "zzz-123456");
});
