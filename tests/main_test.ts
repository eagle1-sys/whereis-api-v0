/**
 * @file main_test.ts
 * @description This file contains automated tests for various shipping-related operations
 * including MD5 hashing, FedEx and SF Express tracking, and API endpoint verification.
 * The tests use Deno's testing framework and assert module for validation.
 */

import { assert } from "@std/assert";
import { loadEnv, loadMetaData } from "../main/app.ts";

export function getHttpStatusFromErrorCode(errorCode: string): number {
  const match = errorCode.match(/^(\d{3})/);
  return match ? parseInt(match[1], 10) : 500; // Default to 500 if parsing fails
}


export function assertErrorCode(
  responseStatus: number,
  responseJSON: Record<string, unknown>,
  output: Record<string, unknown>,
) {
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  const expectedStatus = getHttpStatusFromErrorCode(output.error as string);
  assert(
    responseStatus === expectedStatus,
    `Expected HTTP status ${expectedStatus}, but got ${responseStatus}`,
  );

  assert(
    hasOwnProperty.call(responseJSON, "error"),
    `Expected error response, but got: ${JSON.stringify(responseJSON)}`,
  );

  assert(
    responseJSON.error === output.error,
    `Expected error "${output.error}", but got "${responseJSON.error}"`,
  );
}

// Load environment variables and metadata
await loadEnv();
await loadMetaData();

import "./get_fdx_token_test.ts";
import "./get_fdx_events_test.ts";
import "./get_sfex_routes_test.ts";
import "./whereis_api_test.ts";
import "./status_api_test.ts";