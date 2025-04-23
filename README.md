# Eagle1 whereis API

## Goal
We focus on one thing: making it easy to track a shipment’s locations over time with a simple, streamlined API query.

## Problem
Since different logistics providers have their own data formats and APIs, integrating various logistics data poses a significant challenge for app developers.

## Track locations over time

### cURL
```shell
curl https://api.eg1.io/v0/whereis/{{trackingID}} -H "Authorization: Bearer YOUR-TOKEN"
```

> ***{{trackingID}}*** is defined as `operatorCode-trackingNum`. For example, a FedEx trackingID: fdx-888877776666

### TypeScript
```TypeScript
const url = "https://api.eg1.io/v0/whereis/{{trackingID}}";
const response = await fetch(url, {
  method: "GET",
  headers: {
    Authorization: "Bearer YOUR-TOKEN",
  },
});
```

### Response
```JSON
{
  "entity": {
    "id": "fdx-888877776666",
    "type": "waybill",
    "uuid": "eg1_7e3f6f06-2710-4225-8067-62bebfc4x45c",
    "createdAt": "2024-11-11T14:16:48-06:00",
    "additional": {
      "origin": "San Francisco CA United States",
      "destination": "CENTRAL  Hong Kong SAR, China"
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

## The latest status and location

### cURL
```shell
curl https://api.eg1.io/v0/status/{{trackingID}}
```

### TypeScript
```TypeScript
const url = 'https://api.eg1.io/v0/status/{{trackingID}}';
const response = await fetch(url, {
  method: "GET"
});
```

### Response
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

## Deploying to Fly.io

Follow these steps to deploy the application to Fly.io using the provided Dockerfile:

1. **Install Flyctl**  
   If you don’t already have it, install the Fly.io command-line tool (`flyctl`) by following the [official installation guide](https://fly.io/docs/hands-on/install-flyctl/).

2. **Clone the Repository**  
   
   Clone this repository to your local machine:
   ```bash
   git clone https://github.com/eagle1-sys/whereis-api-v0
   cd whereis-api-v0

3. **Log in to Fly.io**
   
   Authenticate with Fly.io using your account:
   ```bash
   flyctl auth login
   ```

4. **Create Database cluster**
   ```bash
   fly postgres create
   ```  

5. **Deploy the Application**
   
   Run the following command to deploy the app to Fly.io. This will use the Dockerfile to build and deploy your application:
      bash
      ```bash
      flyctl deploy
      ```
   
6. **Check the Status**

   Once the deployment is complete, you can check the status of your app:
   ```bash
   flyctl status
   ```

