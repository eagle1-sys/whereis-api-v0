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
import {
  initializeOperatorStatus,
  loadEnv,
  loadMetaData,
} from "../src/main/app.ts";

export function getHttpStatusFromErrorCode(errorCode: string): number {
  const match = errorCode.match(/^(\d{3})/);
  return match ? parseInt(match[1], 10) : 500; // Default to 500 if parsing fails
}

/**
 * Handles the case of an empty data error in the API response.
 * This function checks if the error code is "404-01" and asserts that the response status is 404.
 *
 * @param response - The Response object from the API call.
 * @param responseJSON - The parsed JSON response body as a Record<string, unknown>.
 */
export function handleEmptyDataError(
  response: Response,
  responseJSON: Record<string, unknown>,
): boolean {
  if (responseJSON.error === "404-01") {
    assert(
      response.status === 404,
      `UnExpected response status ${JSON.stringify(responseJSON)}`,
    );
    return true;
  }
  return false;
}

export function assertErrorCode(
  responseStatus: number,
  responseJSON: Record<string, unknown>,
  expectedOutput: Record<string, unknown>,
) {
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  const expectedStatus = getHttpStatusFromErrorCode(
    expectedOutput.error as string,
  );
  if (responseJSON.error === "404-01") {
    return;
  }

  assert(
    responseStatus === expectedStatus,
    `Expected HTTP status ${expectedStatus}, but received ${responseStatus} in the response ${
      JSON.stringify(responseJSON)
    }`,
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

export const WHEREIS_API_URL = Deno.env.get("WHEREIS_API_URL");

import { isOperatorActive } from "../src/main/gateway.ts";

import { getTokenFromFdXTest } from "./get-fdx-token-test.ts";
import { getEventsFromFdxTest } from "./get-fdx-events-test.ts";
import { getRoutesFromSfexTest } from "./get-sfex-routes-test.ts";
import { whereisApiTest } from "./whereis-api-test.ts";
import { statusApiTest } from "./status-api-test.ts";

if (isOperatorActive("fdx")) {
  getTokenFromFdXTest();
  getEventsFromFdxTest();
}

if (isOperatorActive("sfex")) {
  getRoutesFromSfexTest();
}

if (WHEREIS_API_URL !== undefined) {
  whereisApiTest();

  statusApiTest();
}
