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
import { getTestConfig } from "./main_test.ts";

const testDatas = [
  {
    "input": { "id": "sfex-SF3122082959115", "extra": { "phonenum": "5567" } },
    "output": { "error": "404-01" },
    "memo":
      "Completed waybills cannot be queried for route data after 3 months.",
  },
  {
    "input": { "id": "fdx-779879860040" },
    "output": { "status": 3500 },
    "memo":
      "Completed waybills will have most of their events data removed after a period of time.",
  },
];

Deno.test("Test status API", async () => {
  // Initialize test configuration
  const { protocol, host, port } = await getTestConfig();

  for (let i = 0; i < testDatas.length; i++) {
    const data = testDatas[i];
    const input = data["input"];
    const output = data["output"];
    const trackingId: string = input["id"];
    const extra: { [key: string]: string | undefined } | undefined = input["extra"];
    let url = `${protocol}://${host}:${port}/v0/status/${trackingId}`;
    if (extra !== undefined) {
      //const params = new URLSearchParams(extra);
      const params = new URLSearchParams(extra as Record<string, string>);
      url = url + "?" + params.toString();
    }

    // issue http request
    const response = await fetch(url, {
      method: "GET",
    });

    const responseJSON = await response.json();
    if (Object.prototype.hasOwnProperty.call(output, "error")) {
      assert(
        Object.prototype.hasOwnProperty.call(responseJSON, "error") &&
          responseJSON["error"] == output["error"],
      );
    } else {
      assert(
        Object.prototype.hasOwnProperty.call(responseJSON, "status") &&
          responseJSON["status"] == output["status"],
      );
    }
  }
});
