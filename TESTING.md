# Eagle1 whereis API Testing Documentation

## Overview

The tests folder in the project contains a comprehensive suite of unit and integration tests designed to ensure the reliability and correctness of various components of the API. These tests cover different aspects of the system, including token retrieval, event fetching, route retrieval, and API endpoint functionality for multiple carriers such as FedEx and SF Express.

## Testing Approach

1. **Unit Testing**: Individual components and methods are tested in isolation (e.g., token retrieval, event fetching).
2. **Integration Testing**: API endpoints are tested to ensure proper interaction between different parts of the system.
3. **Parameterized Testing**: Tests use predefined test data to cover various scenarios and edge cases.
4. **Error Handling**: Tests include cases to verify proper error handling and reporting.
5. **Cross-carrier Testing**: The test suite covers multiple carriers (FedEx and SF Express) to ensure compatibility and consistency.

## Test Files

The modular structure of the tests allows for easy maintenance and expansion as new features are added to the API.

1. **main_test.ts**
2. **get_fdx_token_test.ts**
3. **get_fdx_events_test.ts**
4. **get_sfex_routes_test.ts**
5. **whereis_api_test.ts**
6. **status_api_test.ts**

### Each test file (except main_test.ts) consists of two parts:

1. **Test Data**: Defines the input data required for the current test and the expected output results.
2. **Test Code**: Reads the input test data, calls the API to obtain the return value, and compares it with the expected output defined in the test data.

## Test Configuration

The tests use a configuration file (`config_dev.json`) to set up the testing environment. This file contains:

```json
{
  "server": {
    "protocol": "http",
    "host": "localhost",
    "port": 8080
  },
  "bearerToken": "Your-Token"
}
```

This configuration specifies the server details and authentication token used for testing.

## Test Structure

### 1. main_test.ts

This file serves as the entry point for the test suite. It includes the following key features:

- Loads environment variables and metadata required for testing. (`initTestConfig`)
- Handles command-line arguments to specify different test configuration files.
- Imports and runs all other test files.

### 2. get_fdx_token_test.ts

This file tests the FedEx API token retrieval functionality:

- Tests the `Fdx.getToken()` method.
- Verifies that a valid authentication token is retrieved from the FedEx API.
- Checks if the returned token has the expected length.

### 3. get_fdx_events_test.ts

This file contains unit tests for retrieving FedEx shipment tracking events:

- Tests the `Fdx.getRoute()` method.
- Verifies that the correct number of scan events are retrieved for a given tracking number.
- Uses predefined test data, including a sample tracking number and expected event count.

### 4. get_sfex_routes_test.ts

This file tests the retrieval of SF Express shipment tracking routes:

- Tests the `Sfex.getRoute()` method.
- Verifies that the correct number of route events are retrieved for a given tracking number and phone number.
- Uses predefined test data and accounts for potential limitations with completed waybills.

### 5. whereis_api_test.ts

This file contains integration tests for the "whereis" API endpoint:

- Tests the `/v0/whereis/{trackingId}` endpoint.
- Verifies the API's ability to retrieve tracking information for various carriers, including SF Express.
- Checks if the API returns the expected number of tracking events for each test case.
- Includes tests for completed waybills to demonstrate handling of historical data limitations.

### 6. status_api_test.ts

This file contains integration tests for the "status" API endpoint:

- Tests the `/v0/status/{trackingId}` endpoint.
- Verifies the API's ability to retrieve the current status of shipments for various carriers.
- Includes test cases for both SF Express and FedEx shipments.
- Checks for correct error codes and status codes in different scenarios.

## Running Tests

Tests can be run using the Deno test runner. The `main_test.ts` file serves as the entry point.

To run the tests, use the following command:

```bash
deno test --allow-net --allow-read --allow-env tests/main_test.ts
```
The test runner loads `config_dev.json` from the `tests` folder by default. Ensure this file is present in the `tests` directory before running the tests.

You can also specify a different configuration file using command-line arguments:

```bash
deno test --allow-net --allow-read --allow-env tests/main_test.ts custom_config.json
```

## Note

The current test results heavily rely on the data provided by external data providers. For the same trackingId, due to reasons on the data provider's side, the data obtained at different times may vary. Therefore, if the test results are inconsistent with the expected results during testing, the first step is to confirm whether this is due to changes in the data source.