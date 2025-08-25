/**
 * @file main-test.ts
 * @description This file contains automated tests for various shipping-related operations
 * including MD5 hashing, FedEx and SF Express tracking, and API endpoint verification.
 * The tests use Deno's testing framework and assert module for validation.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { assert } from "@std/assert";
import {initializeOperatorStatus, loadEnv, loadMetaData} from "../main/app.ts";

export function getHttpStatusFromErrorCode(errorCode: string): number {
  const match = errorCode.match(/^(\d{3})/);
  return match ? parseInt(match[1], 10) : 500; // Default to 500 if parsing fails
}


export function assertErrorCode(
  responseStatus: number,
  responseJSON: Record<string, unknown>,
  expectedOutput: Record<string, unknown>,
) {
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  const expectedStatus = getHttpStatusFromErrorCode(expectedOutput.error as string);
  assert(
    responseStatus === expectedStatus,
    `Expected HTTP status ${expectedStatus}, but received ${responseStatus} in the response ${JSON.stringify(responseJSON)}`,
  );

  assert(
    hasOwnProperty.call(responseJSON, "error"),
    `Expected error response, but got: ${JSON.stringify(responseJSON)}`,
  );

  assert(
    responseJSON.error === expectedOutput.error,
    `Expected error "${expectedOutput.error}", but got "${responseJSON.error}"`,
  );
}

// Load environment variables and metadata
await loadEnv();
await loadMetaData();

initializeOperatorStatus(); // initialize operator status

export const TESTING_URL = Deno.env.get("TESTING_URL");

import "./get-fdx-token-test.ts";
import "./get-fdx-events-test.ts";
import "./get-sfex-routes-test.ts";
import "./whereis-api-test.ts";
import "./status-api-test.ts";