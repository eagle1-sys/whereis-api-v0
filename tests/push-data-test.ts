import {httpPost} from "../src/tools/util.ts";

import { assert } from "@std/assert";
import { WHEREIS_API_URL } from "./main-test.ts";

const testData: Record<string, unknown> = {
    "eg1DataVersion": 1,
    "events": [
        {
            "trackingNum": "123412341234",
            "status": 3000,
            "what": "Transport Bill Created",
            "whom": "Eagle1",
            "when": "2024-11-11T14:16:48-06:00",
            "where": "Customer location",
            "notes": "Shipment information sent to Operator"
        },
        {
            "trackingNum": "123412341234",
            "status": 3100,
            "what": "Received by Carrier",
            "whom": "Eagle1",
            "when": "2024-11-11T15:16:48-06:00",
            "where": "Warehouse",
            "notes": "Package received"
        },
        {
            "trackingNum": "567856785678",
            "status": 3000,
            "what": "Transport Bill Created",
            "whom": "Eagle1",
            "when": "2024-11-11T14:20:00-06:00",
            "where": "Customer location",
            "notes": "Another shipment"
        }
    ]
};


export function pushDataTest() {
    const apiKey = Deno.env.get("WHEREIS_API_KEY");
    if (!apiKey) {
        throw new Error("WHEREIS_API_KEY environment variable is not set");
    }
    Deno.test("Test push API", async () => {
        const url = `${WHEREIS_API_URL}/v0/push/eg1`;
        const response = await httpPost(
            url,
            {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            JSON.stringify(testData)
        );

        assert(
            response.status === 200,
            `Expected HTTP 200, but received ${response.status}`
        );

        const result = await response.json();
        assert(
            result.eventsReceived === 3,
            `Expected event received num >= 0, but received ${result.eventsReceived}`
        );
    });

}