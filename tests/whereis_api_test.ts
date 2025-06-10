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
    "output": { "eventNum": 1 },
    "memo":
      "Completed waybills will have most of their events data removed after a period of time.",
  },
];

Deno.test("Test whereis API", async () => {
  // Initialize test configuration
  const { protocol, host, port, bearerToken } = await getTestConfig();

  for (let i = 0; i < testDatas.length; i++) {
    const data = testDatas[i];
    const input = data["input"];
    const output = data["output"];
    const trackingId: string = input["id"];
    const extra: { [key: string]: string | undefined } | undefined = input["extra"];
    let url = `${protocol}://${host}:${port}/v0/whereis/${trackingId}`;
    if (extra !== undefined) {
      //const params = new URLSearchParams(extra);
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

    const responseJSON = await response.json();
    if (Object.prototype.hasOwnProperty.call(output, "error")) {
      assert(
        Object.prototype.hasOwnProperty.call(responseJSON, "error") &&
          responseJSON["error"] == output["error"],
      );
    } else {
      assert(
        Object.prototype.hasOwnProperty.call(responseJSON, "events") &&
          responseJSON["events"].length == output["eventNum"],
      );
    }
  }
});
