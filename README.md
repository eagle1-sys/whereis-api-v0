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

