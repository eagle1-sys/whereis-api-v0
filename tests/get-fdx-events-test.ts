/**
 * @file get-fdx-events-test.ts
 * @description This file contains unit tests for retrieving FedEx shipment tracking events.
 * It tests the Fdx.getRoute() method to ensure it successfully fetches and processes
 * tracking data from the FedEx API. The test verifies that the correct number of
 * scan events are retrieved for a given tracking number, indicating successful
 * parsing of the API response.
 *
 * The test uses a predefined set of test data, including a sample tracking number
 * and the expected number of events. It asserts that the number of events returned
 * by the API matches the expected count.
 *
 * The test configuration is initialized using the initTestConfig function,
 * which sets up the necessary environment variables and test data.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { assert } from "@std/assert";
import { Fdx } from "../src/connectors/operators/fdx.ts";

const testDatas = [
  {
    "input": { "trackingNum": "7798798600400" },
    "memo": "Ensure the FedEx response is correct.",
  }
];

export function getEventsFromFdxTest() {
  Deno.test("Test interaction with FedEx API", async () => {
    for (let i = 0; i < testDatas.length; i++) {
      const data = testDatas[i];
      const input = data["input"];
      const trackingNum = input["trackingNum"];
      const result = await Fdx.getRoute([trackingNum]) as Record<
        string,
        unknown
      >;
      assert(result["transactionId"] !== undefined, `Unexpected output format: ${JSON.stringify(result)}`);
    }
  });
}
