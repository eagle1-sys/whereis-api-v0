/**
 * @file reference_test.ts
 * @description Keeps the embedded status reference in sync with metadata/.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { assertEquals } from "@std/assert";
import { parse } from "@std/jsonc";
import { EXCEPTION_CODES, STATUS_CODES } from "../src/reference.ts";

function toNumericRecord(
  source: Record<string, unknown>,
): Record<number, string> {
  const result: Record<number, string> = {};
  for (const [key, value] of Object.entries(source)) {
    result[Number(key)] = String(value);
  }
  return result;
}

async function readMetadata(name: string): Promise<Record<string, unknown>> {
  const path = new URL(`../../metadata/${name}`, import.meta.url);
  const text = await Deno.readTextFile(path);
  return parse(text) as Record<string, unknown>;
}

Deno.test("status codes match metadata/status-codes.jsonc", async () => {
  const metadata = await readMetadata("status-codes.jsonc");
  assertEquals(STATUS_CODES, toNumericRecord(metadata));
});

Deno.test("exception codes match metadata/exception-codes.jsonc", async () => {
  const metadata = await readMetadata("exception-codes.jsonc");
  assertEquals(EXCEPTION_CODES, toNumericRecord(metadata));
});
