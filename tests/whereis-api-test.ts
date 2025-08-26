/**
 * @file whereis-api-test.ts
 * @description This file contains integration tests for the "whereis" API endpoint of the shipment tracking system.
 * It tests the API's ability to retrieve tracking information for various carriers, including SF Express.
 *
 * The test sends HTTP GET requests to the /v0/whereis/{trackingId} endpoint, passing necessary parameters
 * such as tracking number and phone number (for SF Express). It then verifies that the API returns the
 * expected number of tracking events for each test case.
 *
 * Test data includes cases for completed waybills, demonstrating the system's handling of historical data limitations.
 * For instance, SF Express data may not be available for waybills older than 3 months.
 *
 * The test configuration, including server details and authentication token, is initialized using the initTestConfig function.
 * This setup ensures that the tests are run against the correct environment with proper authentication.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { assert } from "@std/assert";
import { WHEREIS_API_URL } from "./main-test.ts";
import { assertErrorCode } from "./main-test.ts";
import {isOperatorActive} from "../main/gateway.ts";

const testData = [
  {
    "input": { "id": "", "extra": {} },
    "output": { "error": "400-01" },
    "memo": "Missing tracking number.",
  },
  {
    "input": { "id": "sfex-SF123456789", "extra": { "phonenum": "5567" } },
    "output": { "error": "400-02" },
    "memo": "Invalid tracking number.",
  },
  {
    "input": { "id": "sfex-SF3122082959115", "extra": { "phonenum": "" } },
    "output": { "error": "400-03" },
    "memo": "Missing phone number.",
  },
  {
    "input": { "id": "fake-SF3122082959115", "extra": { "phonenum": "5567" } },
    "output": { "error": "400-04" },
    "memo": "Invalid operator code.",
  },
  {
    "input": { "id": "SF3122082959115", "extra": { "phonenum": "5567" } },
    "output": { "error": "400-05" },
    "memo": "Invalid slug notation.",
  },
  {
    "input": { "id": "sfex-SF3182998070266", "extra": { "phonenum": "6993" } },
    "output": { "eventNum": 20 },
    "memo": "Pull data from data providers with correct phone num.",
  },
  {
    "input": { "id": "sfex-SF3182998070266", "extra": { "phonenum": "6994" } },
    "output": { "error": "400-06" },
    "memo":
      "Incorrect phonenum. correct phonenum is 6993. This testing depends on the previous test case.",
  },
  {
    "input": { "id": "fdx-881383013147", "extra": { "full_data": "true" } },
    "output": { "error": "400-07" },
    "memo": "Bad request: Invalid query parameters [full_data]",
  },
  {
    "input": { "id": "sfex-SF3122082959115", "extra": { "phonenum": "5567" } },
    "output": { "error": "404-01" },
    "memo":
      "Completed SF waybills cannot be queried for route data after 3 months.",
  },
  {
    "input": { "id": "fdx-779879860040" },
    "output": { "eventNum": 1 },
    "memo":
      "Completed FedEx waybills will have most of their events data removed after a period of time.",
  },
];

Deno.test("Test missing auth header", async () => {
  if(WHEREIS_API_URL === undefined) {
    console.log("   Skipping test because the WHEREIS_API_URL environment variable is not set.");
    return;
  }

  const url = `${WHEREIS_API_URL}/v0/whereis/fdx-779879860040`;
  // issue http request
  const response = await fetch(url, {
    method: "GET",
  });

  await assertResponse(response, { "error": "401-01" });
});

Deno.test("Test invalid token", async () => {
  if(WHEREIS_API_URL === undefined) {
    console.log("   Skipping test because the TESTING_URL environment variable is not set.");
    return;
  }

  const url = `${WHEREIS_API_URL}/v0/whereis/fdx-779879860040`;
  // issue http request
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer JUNK`,
    },
  });

  await assertResponse(response, { "error": "401-02" });
});

Deno.test("Test whereis API", async () => {
  if(WHEREIS_API_URL === undefined) {
    console.log("   Skipping test because the TESTING_URL environment variable is not set.");
    return;
  }

  for (let i = 0; i < testData.length; i++) {
    const data = testData[i];
    const input = data["input"];
    const output = data["output"];
    const trackingId: string = input["id"];
    if((trackingId.startsWith("fdx-") && !isOperatorActive("fdx") ||
        (trackingId.startsWith("sfex-") && !isOperatorActive("sfex")))) {
      console.log(`   Skipping test for ${trackingId} because the operator API keys are not configured.`);
      continue;
    }

    const extra: { [key: string]: string | undefined } | undefined =
      input["extra"];
    let url = `${WHEREIS_API_URL}/v0/whereis/${trackingId}`;
    if (extra !== undefined) {
      const params = new URLSearchParams(extra as Record<string, string>);
      url = url + "?" + params.toString();
    }

    // issue http request
    const apiKey = Deno.env.get("WHEREIS_API_KEY");
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    await assertResponse(response, output);
  }
});

async function assertResponse(
  response: Response,
  output: Record<string, unknown>,
) {
  const responseJSON = await response.json();

  switch (true) {
    case "error" in output: {
      //await assertStatus(response, output);
      assertErrorCode(response.status, responseJSON, output);
      break;
    }

    case "eventNum" in output: {
      const events = responseJSON.events ?? [];
      const expectedEventNum = output.eventNum as number;

      assert(
        Array.isArray(events),
        `Expected events in response, but got: ${JSON.stringify(responseJSON)}`,
      );
      assert(
        events.length === expectedEventNum,
        `Expected ${expectedEventNum} events, but got ${events.length}`,
      );
      break;
    }

    default: {
      throw new Error(`Unexpected output format: ${JSON.stringify(output)}`);
    }
  }
}