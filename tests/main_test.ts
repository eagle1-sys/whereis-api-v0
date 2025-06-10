/**
 * @file main_test.ts
 * @description This file contains automated tests for various shipping-related operations
 * including MD5 hashing, FedEx and SF Express tracking, and API endpoint verification.
 * The tests use Deno's testing framework and assert module for validation.
 */

import { loadJSONFromFs } from "../tools/util.ts";
import { loadEnv, loadMetaData } from "../main/app.ts";

// Read CLI parameters
const cliArgs = Deno.args;

let testData: Record<string, unknown> | null = null;

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
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.error(`Error: The file "${fileName}" does not exist.`);
        Deno.exit(1); // Exit the program with an error code
      } else {
        console.error(`Error reading file "${fileName}":`, error);
        Deno.exit(1);
      }
    }
  }
}

export async function getTestConfig() {
  await initTestConfig();

  if (!testData || typeof testData !== "object") {
    throw new Error("Test data is not properly initialized");
  }

  return {
    protocol: (testData as { server: { protocol: string } }).server.protocol,
    host: (testData as { server: { host: string } }).server.host,
    port: (testData as { server: { port: number } }).server.port,
    bearerToken: testData.bearerToken as string,
  };
}

// Initialize test configuration
await initTestConfig();

import "./get_fdx_token_test.ts";
import "./get_fdx_events_test.ts";
import "./get_sfex_routes_test.ts";
import "./whereis_api_test.ts";
import "./status_api_test.ts";
