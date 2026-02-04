# Eagle1 Whereis API
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/eagle1-sys/whereis-api-v0)

## Goal
**Making it easy** for developers to track any shipment (with any logistics provider), using a simple API query.

## Problem
Since different logistics providers have their own APIs and data formats, integrating various logistics data poses a significant challenge for app developers.

## Scope
1. This prototype is written in TypeScript and runs on the [Deno runtime](https://deno.com).
2. We have defined [standard status codes](metadata/status-codes.jsonc) and a consistent format for global logistics data.
3. Initially it supports two logistics operators: FedEx and SF Express, with a [future roadmap](https://github.com/eagle1-sys/whereis-api-v0/discussions/97) planned. Code review is on [DeepWiki](https://deepwiki.com/eagle1-sys/whereis-api-v0).

### Design intentions
- **Beyond Simple Mapping**: Transform raw carrier data into meaningful, standardized information.
- **Developer-Centric**: Provide consistent, easy-to-understand API responses.
- **Continuous Improvement**: Mapping rules evolve based on real-world data patterns via a two-stage process: (Stage 1: rule-based mapping; Stage 2: AI-assisted enhancement).

### Documentation
- [Wiki](https://github.com/eagle1-sys/whereis-api-v0/wiki)


## Examples

### Track locations over time

#### cURL
```shell
curl https://api.eg1.io/v0/whereis/{{trackingID}} -H "Authorization: Bearer YOUR-TOKEN"
```

> ***{{trackingID}}*** uses the structure `operatorCode-trackingNum`. Example: a FedEx trackingID is `fdx-888877776666`.

#### TypeScript
```TypeScript
const url = "https://api.eg1.io/v0/whereis/{{trackingID}}";
const response = await fetch(url, {
  method: "GET",
  headers: {
    Authorization: "Bearer YOUR-TOKEN",
  },
});
```

#### Response (consistent format for all logistics providers)
```JSON
{
  "entity": {
    "id": "fdx-888877776666",
    "type": "waybill",
    "uuid": "eg1_7e3f6f06-2710-4225-8067-62bebfc4x45c",
    "createdAt": "2024-11-11T14:16:48-06:00",
    "additional": {
      "origin": "San Francisco CA United States",
      "destination": "CENTRAL  Hong Kong SAR, China",
      "isCrossBorder": true,
      "processingTimeMs": 3.7
    }
  },
  "events": [{
    "status": 3000,
    "what": "Transport Bill Created",
    "whom": "FedEx",
    "when": "2024-11-11T14:16:48-06:00",
    "where": "Customer location",
    "notes": "Shipment information sent to FedEx",
    "additional": {
      "trackingNum": "888877776666",
      "operatorCode": "fdx",
      "dataProvider": "FedEx",
      "updateMethod": "manual-pull",
      "updatedAt": "2025-02-20T12:23:43.892Z"
    }
  }]
}
```

---

### The latest status and location

#### cURL
```shell
curl https://api.eg1.io/v0/status/{{trackingID}}
```

#### TypeScript
```TypeScript
const url = 'https://api.eg1.io/v0/status/{{trackingID}}';
const response = await fetch(url, {
  method: "GET"
});
```

#### Response
```json
{
  "id": "fdx-888877776666",
  "status": 3000,
  "what": "Transport Bill Created",
  "whom": "FedEx",
  "when": "2024-11-11T14:16:48-06:00",
  "where": "Customer location",
  "notes": "Shipment information sent to FedEx"
}
```

---

# Getting started

There are only three commands to deploy locally with Docker! Detailed, step-by-step instructions can be found in the [How-to Guide](https://github.com/eagle1-sys/whereis-api-v0/wiki/How%E2%80%90to:-Local-DEV-deployment-using-docker).

```bash
git clone https://github.com/eagle1-sys/whereis-api-v0
cd whereis-api-v0
make whereis
```

That's it. Enjoy!
