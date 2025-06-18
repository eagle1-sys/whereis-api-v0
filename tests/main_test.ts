/**
 * @file main_test.ts
 * @description This file contains automated tests for various shipping-related operations
 * including MD5 hashing, FedEx and SF Express tracking, and API endpoint verification.
 * The tests use Deno's testing framework and assert module for validation.
 */

import { assert } from "@std/assert";
import { loadJSONFromFs } from "../tools/util.ts";
import { loadEnv, loadMetaData } from "../main/app.ts";

// Read CLI parameters
const cliArgs = Deno.args;

let testData: Record<string, unknown> | null = null;

export function getHttpStatusFromErrorCode(errorCode: string): number {
  const match = errorCode.match(/^(\d{3})/);
  return match ? parseInt(match[1], 10) : 500; // Default to 500 if parsing fails
}

async function initTestConfig() {
  if (testData === null) {
    // Load environment variables and metadata
    await loadEnv();
    await loadMetaData();

    // Default file name for testing data
    let fileName = "config_dev.json";
    if (cliArgs.length > 0) {
      fileName = cliArgs[0];
    }
    // The testing config data file is expected to be in the "tests" directory
    const filePath = `${Deno.cwd()}/tests/${fileName}`;

    try {
      // Check if the file exists
      await Deno.stat(filePath);

      // Load testing config data from file system
      testData = await loadJSONFromFs(filePath);
      // Set testData values to Deno.env
      setToEnv(testData);
    } catch (error) {
      //if (error instanceof Deno.errors.NotFound) {
      //  console.error(`Error: The file "${fileName}" does not exist.`);
      //  Deno.exit(1); // Exit the program with an error code
      //} else {
      //  console.error(`Error reading file "${fileName}":`, error);
      //  Deno.exit(1);
      //}
    }
  }
}

function setToEnv(data: Record<string, unknown>) {
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        Deno.env.set(key, String(value));
      } else if (typeof value === "object" && value !== null) {
        setToEnv(value as Record<string, unknown>);
      }
    }
  }
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

// Initialize test configuration
await initTestConfig();

import "./get_fdx_token_test.ts";
import "./get_fdx_events_test.ts";
import "./get_sfex_routes_test.ts";
import "./whereis_api_test.ts";
import "./status_api_test.ts";
