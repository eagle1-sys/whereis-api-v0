/**
 * @file whereis_test.ts
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
 */
import { assert } from "@std/assert";
import { getHttpStatusFromErrorCode, getTestConfig } from "./main_test.ts";

const testDatas = [
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
    "input": { "id": "sfex-SF3182998070266", "extra": { "phonenum": "6994" } },
    "output": { "error": "400-06" },
    "memo": "Incorrect phonenum. correct phonenum is 6993",
  },
  {
    "input": { "id": "fdx-881383013147", "extra": { "full_data": "true" } },
    "output": { "error": "400-07" },
    "memo": "Incorrect phonenum. correct phonenum is 6993",
  },
  {
    "input": { "id": "sfex-SF3122082959115", "extra": { "phonenum": "5567" } },
    "output": { "error": "404-01" },
    "memo":
      "Completed waybills cannot be queried for route data after 3 months.",
  },
  {
    "input": { "id": "fdx-779879860040" },
    "output": { "eventNum": 1 },
    "memo":
      "Completed waybills will have most of their events data removed after a period of time.",
  },
];

Deno.test("Test missing auth header", async () => {
  // Initialize test configuration
  const { protocol, host, port } = await getTestConfig();
  const url = `${protocol}://${host}:${port}/v0/whereis/fdx-779879860040`;

  // issue http request
  const response = await fetch(url, {
    method: "GET",
  });

  await assertResponse(response, { "error": "401-01" });
});

Deno.test("Test invalid token", async () => {
  // Initialize test configuration
  const { protocol, host, port } = await getTestConfig();
  const url = `${protocol}://${host}:${port}/v0/whereis/fdx-779879860040`;

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
  // Initialize test configuration
  const { protocol, host, port, bearerToken } = await getTestConfig();

  for (let i = 0; i < testDatas.length; i++) {
    const data = testDatas[i];
    const input = data["input"];
    const output = data["output"];
    const trackingId: string = input["id"];
    const extra: { [key: string]: string | undefined } | undefined =
      input["extra"];
    let url = `${protocol}://${host}:${port}/v0/whereis/${trackingId}`;
    if (extra !== undefined) {
      const params = new URLSearchParams(extra as Record<string, string>);
      url = url + "?" + params.toString();
    }

    // issue http request
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
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
  const hasOwnProperty = Object.prototype.hasOwnProperty;

  if (hasOwnProperty.call(output, "error")) {
    const expectedStatus = getHttpStatusFromErrorCode(output.error as string);
    assert(
      response.status === expectedStatus,
      `Expected HTTP status ${expectedStatus}, but got ${response.status}`,
    );

    assert(
      hasOwnProperty.call(responseJSON, "error"),
      `Expected error response, but got: ${JSON.stringify(responseJSON)}`,
    );
    assert(
      responseJSON.error === output.error,
      `Expected error "${output.error}", but got "${responseJSON.error}"`,
    );
  } else if (hasOwnProperty.call(output, "eventNum")) {
    assert(
      hasOwnProperty.call(responseJSON, "events"),
      `Expected events in response, but got: ${JSON.stringify(responseJSON)}`,
    );
    assert(
      responseJSON.events.length === output.eventNum,
      `Expected ${output.eventNum} events, but got ${responseJSON.events.length}`,
    );
  } else {
    throw new Error(`Unexpected output format: ${JSON.stringify(output)}`);
  }
}
