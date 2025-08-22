/**
 * @file get-fdx-token-test.ts
 * @description This file contains unit tests for the FedEx API token retrieval functionality.
 * It tests the Fdx.getToken() method to ensure it successfully retrieves a valid
 * authentication token from the FedEx API. The test verifies that the returned token
 * has the expected length, indicating a successful API response.
 *
 * The test configuration is initialized using the initTestConfig function,
 * which sets up the necessary environment variables and test data.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { assertEquals } from "@std/assert";
import { Fdx } from "../operators/fdx.ts";
import {isOperatorActive} from "../main/gateway.ts";

Deno.test("Test get token from FedEx", async () => {
  if(!isOperatorActive('fdx') ) {
    console.log("   The test was skipped because the FedEx API keys are not configured.");
    return;
  }

  const token = await Fdx.getToken();
  assertEquals(token.length, 1269, "FedEx token should have a length of 1269 characters");
});
