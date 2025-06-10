/**
 * @file get_fdx_events_test.ts
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
 */
import { assert } from "@std/assert";
import { Fdx } from "../operators/fdx.ts";

const testDatas = [
  {
    "input": { "trackingNum": "779879860040" },
    "output": { "eventNum": 1 },
    "memo":
      "Completed waybills will have most of their events data removed after a period of time.",
  },
];

Deno.test("Test get scan events from FedEx", async () => {
  for (let i = 0; i < testDatas.length; i++) {
    const data = testDatas[i];
    const input = data["input"];
    const output = data["output"];
    const trackingNum = input["trackingNum"];
    const result = await Fdx.getRoute(trackingNum) as any;
    assert(result != undefined);
    const events =
      result["output"]["completeTrackResults"][0]["trackResults"][0][
        "scanEvents"
      ];
    assert(events.length == output["eventNum"]);
  }
});
