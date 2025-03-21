# Eagle1 whereis API

## Goal
The goal of this project is to solve one problem: to track the current location of a shipment through the simplest possible API query.

## Concept
Since different logistics providers have their own data formats and APIs, integrating various logistics data poses a significant challenge for app developers.

## Track the location

### CURL
```shell
curl https://api.eg1.io/v0/whereis/fdx-123456 -H "bearer key"
```

### TypeScript
```TypeScript
const url = 'https://api.eg1.io/v0/whereis/fdx-123456'
const response = await fetch(url, {
    method: "GET",
    headers: {
            "Authorization": "Bearer YOUR-TOKEN"
    },
});
```

### Response
```JSON
{
  "object": {
    "uuid": "eg1_7e3f6f06-2710-4225-8067-62bebfc4e45c",
    "id": "fdx-123456",
    "type": "waybill",
    "creationTime": "2024-11-11T14:16:48-06:00",
    "additional": {
      "origin": "San Francisco CA United States",
      "destination": "CENTRAL  Hong Kong SAR, China"
    }
  },
  "events": [
    {
      "status": 3000,
      "what": "Transport Bill Created",
      "when": "2024-11-11T14:16:48-06:00",
      "where": "Customer location",
      "whom": "FedEx",
      "additional": {
        "operatorCode": "fdx",
        "trackingNum": "779879860040",
        "notes": "Shipment information sent to FedEx",
        "dataProvider": "FedEx",
        "lastUpdateMethod": "manual-pull",
        "lastUpdateTime": "2025-02-20T12:23:43.892Z"
      }
    }
  ]
}
```

## Track the status

### CURL
```shell
curl https://api.eg1.io/v0/status/fdx-123456
```

### TypeScript
```TypeScript
const url = 'https://api.eg1.io/v0/status/fdx-123456'
const response = await fetch(url, {
    method: "GET"
});
```

### Response
```json
{
  "id": "fdx-123456",
  "status": 3500,
  "what": "Delivered"
}
```