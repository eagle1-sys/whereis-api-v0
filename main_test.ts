import { assert, assertEquals } from "@std/assert";
import { jsonToMd5, loadJSONFromFs } from "./util.ts";
import { Fedex } from "./operators/fedex.ts";
import { Sfex } from "./operators/sfex.ts";
import "https://deno.land/x/dotenv/load.ts";
import { loadEnv, loadMetaData } from "./app.ts";

// load environment variable first
await loadEnv();
// load file system data
await loadMetaData();

// Define function Map
const functionMap: { [key: string]: (arg: any) => any } = {
  "md5": md5Test,
  "getFedExToken": getFedExToken,
  "getFedExRoute": getFedExRoute,
  "getSfExRoute": getSfExRoute,
  "whereIs": whereIs,
  "getStatus": getStatus,
};

const testData: Record<string, any> = await loadJSONFromFs(
  "./test/test_data.json",
);

// Read the server & token info
const server = testData.server;
const protocol = server.protocol;
const domain = server.host;
const port = server.port;
// Bearer token
const bearerToken = testData.bearerToken;

// Execute the tests
const tests: [] = testData.tests;
for (let i = 0; i < tests.length; i++) {
  const test = tests[i];
  const funcName = test["name"];
  const testDesc = test["desc"];
  const funcData = test["data"];
  if (funcName in functionMap) {
    if (test["async"]) {
      Deno.test(testDesc, async () => {
        await functionMap[funcName](funcData);
      });
    } else {
      Deno.test(testDesc, () => {
        functionMap[funcName](funcData);
      });
    }
  }
}

async function md5Test(data: any) {
  const input = data["input"];
  const output = data["output"];
  const md5Hash = await jsonToMd5(input);
  assertEquals(md5Hash, output["md5hash"]);
}

async function getFedExToken() {
  const token = await Fedex.getToken();
  assertEquals(token.length, 1269);
}

async function getFedExRoute(data: any) {
  const input = data["input"];
  const output = data["output"];
  const trackingNum = input["trackingNum"];
  const result = await Fedex.getRoute(trackingNum);
  assert(result != undefined);
  const events = result["output"]["completeTrackResults"][0]["trackResults"][0][
    "scanEvents"
  ];
  assert(events.length == output["eventNum"]);
}

async function getSfExRoute(data: any) {
  const input = data["input"];
  const output = data["output"];
  const response = await Sfex.getRoute(input["trackingNum"], input["phone"]);
  const apiResultData = JSON.parse(response["apiResultData"]);
  const routes = apiResultData["msgData"]["routeResps"][0]["routes"];
  assert(routes.length == output["routeNum"]);
}

async function whereIs(data: any) {
  const input = data["input"];
  const output = data["output"];
  const trackingNumber: string = input["id"];
  const extra: Record<string, any> = input["extra"];
  let url = `${protocol}://${domain}:${port}/v0/whereis/${trackingNumber}`;
  if (extra !== undefined) {
    const params = new URLSearchParams(extra);
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
  // console.log(responseJSON);
  assert(responseJSON["events"].length == output["eventNum"]);
}

async function getStatus(data: any) {
  const input = data["input"];
  const output = data["output"];
  const trackingNumber: string = input["id"];
  const url = `${protocol}://${domain}:${port}/v0/status/${trackingNumber}`;
  // issue http request
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
    },
  });
  // convert to json
  const responseJSON = await response.json();
  // console.log(responseJSON);
  assert(responseJSON["status"] == output["status"]);
}
