/**
 * @file status_test.ts
 * @description This file contains integration tests for the "status" API endpoint of the shipment tracking system.
 * It tests the API's ability to retrieve the current status of shipments for various carriers, including SF Express and FedEx.
 *
 * The test sends HTTP GET requests to the /v0/status/{trackingId} endpoint, passing necessary parameters
 * such as tracking number and phone number (for SF Express). It then verifies that the API returns the
 * expected status code or error message for each test case.
 *
 * Test data includes cases for:
 * 1. SF Express shipments, which require additional parameters like phone number.
 * 2. FedEx shipments.
 * 3. Completed waybills, demonstrating the system's handling of historical data limitations.
 *    For instance, SF Express data may not be available for waybills older than 3 months.
 *
 * The test configuration, including server details, is initialized using the initTestConfig function.
 * This setup ensures that the tests are run against the correct environment.
 *
 * Each test case verifies either:
 * - The returned error code matches the expected value for error cases.
 * - The returned status code matches the expected value for successful cases.
 *
 * This comprehensive test suite ensures the reliability and accuracy of the status API across different carriers and scenarios.
 */
import { assert } from "@std/assert";
import {config} from "../config.ts";
import { assertErrorCode } from "./main_test.ts";

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
      "Completed SF waybills cannot be queried for route data after 3 months.",
  },
  {
    "input": { "id": "fdx-779879860040" },
    "output": { "status": 3500 },
    "memo":
      "Completed waybills will have most of their events data removed after a period of time.",
  },
];

Deno.test("Test status API", async () => {
  for (let i = 0; i < testDatas.length; i++) {
    const data = testDatas[i];
    const input = data["input"];
    const output = data["output"];
    const trackingId: string = input["id"];
    const extra: { [key: string]: string | undefined } | undefined =
      input["extra"];
    let url = `${config.testing.url}/v0/status/${trackingId}`;
    if (extra !== undefined) {
      //const params = new URLSearchParams(extra);
      const params = new URLSearchParams(extra as Record<string, string>);
      url = url + "?" + params.toString();
    }

    // issue http request
    const response = await fetch(url, {
      method: "GET",
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

    case "status" in output: {
      const status = responseJSON.status;
      assert(
        status !== undefined,
        `Expected status in response, but got: ${JSON.stringify(responseJSON)}`,
      );
      assert(
        responseJSON.status === output.status,
        `Expected status ${output.status} , but got ${responseJSON.status}`,
      );
      break;
    }

    default: {
      throw new Error(`Unexpected output format: ${JSON.stringify(output)}`);
    }
  }
}
