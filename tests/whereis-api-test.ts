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
import { handleEmptyDataError, WHEREIS_API_URL } from "./main-test.ts";
import { assertErrorCode } from "./main-test.ts";
import { getResponseJSON, isOperatorActive } from "../main/gateway.ts";

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
    "input": { "id": "sfex-SF3182998070266", "extra": { "phonenum": "6994" } },
    "output": { "error": "400-03" },
    "memo":
      "Incorrect phonenum. correct phonenum is 6993. This testing depends on the previous test case.",
  },
  {
    "input": { "id": "fdx-881383013147", "extra": { "full_data": "true" } },
    "output": { "error": "400-03" },
    "memo": "Invalid query parameters [full_data]",
  },
  {
    "input": { "id": "fdx-779879860040" },
    "output": { "eventNum": "1" },
    "memo":
      "Completed FedEx waybills will have most of their events data removed after a period of time.",
  },
  {
    "input": { "id": "sfex-SF3182998070266", "extra": { "phonenum": "6993" } },
    "output": { "eventNum": "*" },
    "memo": "Pull data from data providers with correct phone num.",
  },
];

export function whereisApiTest() {
  Deno.test("Test missing WHEREIS_API_KEY", async () => {
    const url = `${WHEREIS_API_URL}/v0/whereis/fdx-779879860040`;
    // issue http request
    const response = await fetch(url, {
      method: "GET",
    });

    await assertResponse(response, { "error": "401-01" });
  });

  Deno.test("Test invalid WHEREIS_API_KEY", async () => {
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
    for (let i = 0; i < testData.length; i++) {
      const data = testData[i];
      const input = data["input"];
      const output = data["output"];
      const trackingId: string = input["id"];

      // Ignore tests for non-active operators
      if (trackingId.startsWith("fdx-") && !isOperatorActive("fdx")) continue;
      if (trackingId.startsWith("sfex-") && !isOperatorActive("sfex")) continue;

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
}

/**
 * Validate a WHEREIS API response against an expected output specification and assert correctness.
 *
 * Accepts two expectation shapes:
 * - { error: string } — verifies the response contains the specified error code via assertErrorCode.
 * - { eventNum: number | "*" } — asserts HTTP 200, that the body contains an `events` array, and that
 *   the number of events meets the expectation:
 *     - 0 : exact zero events
 *     - "*" : at least one event
 *     - number : at least that many events
 *
 * @param response - The fetch Response object returned by the WHEREIS endpoint.
 * @param expectedOutput - An object describing the expected response. Must contain either an `error` key
 *                         or an `eventNum` key as described above.
 * @throws AssertionError if any assertion about status, presence/shape of `events`, or event counts fails.
 */
async function assertResponse(
  response: Response,
  expectedOutput: Record<string, unknown>,
) {
  const responseJSON = await getResponseJSON(response, "500TA - Test");

  switch (true) {
    case "error" in expectedOutput: {
      assertErrorCode(response.status, responseJSON, expectedOutput);
      break;
    }

    case "eventNum" in expectedOutput: {
      if (handleEmptyDataError(response, responseJSON)) {
        break;
      }

      assert(
        response.status === 200,
        `Expected HTTP 200, but received ${response.status} with body ${
          JSON.stringify(responseJSON)
        }`,
      );

      // Assert presence of ‘events’ field explicitly
      assert(
        "events" in responseJSON,
        `SNH - Missing 'events' in response: ${JSON.stringify(responseJSON)}`,
      );

      // Assert eventsValue is an array
      const eventsValue = (responseJSON as Record<string, unknown>)["events"];
      assert(
        Array.isArray(eventsValue),
        `Expected events in response, but got: ${JSON.stringify(responseJSON)}`,
      );

      const events = eventsValue as unknown[];
      const expectedEventNum = expectedOutput.eventNum;

      if (expectedEventNum == 0) {
        assert(
          events.length === expectedEventNum,
          `Expected ${expectedEventNum} events, but got ${events.length}`,
        );
      } else if (expectedEventNum === "*") {
        assert(
          events.length >= 1,
          `Expected ${expectedEventNum} events, but got ${events.length}`,
        );
      } else {
        const numEvents = typeof expectedEventNum === "number"
          ? expectedEventNum
          : parseInt(expectedEventNum as string, 10);
        assert(
          !isNaN(numEvents),
          `Invalid expectedEventNum: ${expectedEventNum}`,
        );
        assert(
          events.length >= numEvents,
          `Expected ${expectedEventNum} events, but got ${events.length}`,
        );
      }
      break;
    }

    default: {
      throw new Error(
        `Unexpected expectedOutput format: ${
          JSON.stringify(expectedOutput)
        }. " +
          "Expected output should contain either 'error' or 'eventNum' key. " +
          "Received response: ${JSON.stringify(responseJSON)}`,
      );
    }
  }
}
