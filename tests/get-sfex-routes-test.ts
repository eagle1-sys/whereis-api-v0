/**
 * @file get-sfex-routes-test.ts
 * @description This file contains unit tests for retrieving SF Express (Sfex) shipment tracking routes.
 * It tests the Sfex.getRoute() method to ensure it successfully fetches and processes
 * tracking data from the SF Express API. The test verifies that the correct number of
 * route events are retrieved for a given tracking number and phone number, indicating
 * successful parsing of the API response.
 *
 * The test uses a predefined set of test data, including a sample tracking number,
 * associated phone number, and the expected number of route events. It asserts that
 * the number of routes returned by the API matches the expected count.
 *
 * Note: As mentioned in the test data, completed waybills may have reduced event data
 * after a certain period, which could affect the test results over time.
 *
 * The test configuration is initialized using the initTestConfig function,
 * which sets up the necessary environment variables and test data.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { assert } from "@std/assert";
import { Sfex } from "../operators/sfex.ts";

const testData = [
  {
    "input": { "trackingNum": "SF3122082959115", "phone": "5567" },
    "output": { "routeNum": 0 },
    "memo":
      "Completed waybills cannot be queried for route data after 3 months.",
  },
  {
    "input": { "trackingNum": "SF3182998070266", "phone": "6993" },
    "output": { "routeNum": 19 },
    "memo":
      "Normal waybill.",
  },
];

export function getRoutesFromSfexTest() {
  Deno.test("Test get scan events from Sfex", async () => {
    for (let i = 0; i < testData.length; i++) {
      const data = testData[i];
      const input = data["input"];
      const output = data["output"];
      const response = await Sfex.getRoute(input["trackingNum"], input["phone"]);
      const apiResultData = JSON.parse(response["apiResultData"] as string);
      const routeResps = apiResultData["msgData"]["routeResps"];
      const routes = routeResps[0]["routes"];
      assert(routes.length == output["routeNum"]);
    }
  });
}

