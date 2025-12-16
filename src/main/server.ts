/**
 * @file Server.ts
 * @description Implements a Hono-based server for tracking package status and location information.
 * Handles HTTP requests, database operations, and carrier API integrations with Bearer token authentication.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { cors } from "hono/cors";
import { Context, Hono, HonoRequest, Next } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { dbClient} from "../db/dbutil.ts";
import { logger } from "../tools/logger.ts";
import {getExtraParams, processPushData, requestWhereIs, validateParams, validateStoredEntity} from "./gateway.ts";
import {ApiParams, Entity, OperatorRegistry, TrackingID, AppError,} from "./model.ts";

declare module "hono" {
  // noinspection JSUnusedGlobalSymbols
  interface Context {
    /**
     * Sends an error response with specified error code and message
     * @param errorCode - The error code in format "HTTPSTATUS-CODE"
     * @returns Response object with JSON error payload
     */
    sendError: (appError: AppError) => Response;
  }
}

/**
 * Server class that manages HTTP endpoints for tracking services
 */
const app = new Hono();

const RESTRICTED_CLIENT_TOKEN = "eagle1";
// Bearer Auth middleware
const customBearerAuth = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("401-01", "401AA: server - AUTH_HEADER");
  }

  const token = authHeader.split(" ")[1];
  const isValidToken = await dbClient.isTokenValid(token); // verify the token
  if (!isValidToken) {
    throw new AppError("401-02", "401AB: server - TOKEN_VALIDATION");
  }

  if (token === RESTRICTED_CLIENT_TOKEN) {
    const path = c.req.path;
    // Handle /vx/whereis/ and /vx/push/ paths
    const isWhereisPath = /^\/v\d+\/whereis\/.+$/.test(path);
    const isPushPath = /^\/v\d+\/push\/.+$/.test(path);
    if (isWhereisPath) {
      // Extract tracking ID from the URL
      const trackingId = c.req.param("id") ?? "";
      const idx = trackingId.trim().indexOf("-");
      if (idx !== -1) {
        const operatorCode = trackingId.substring(0, idx);
        if (operatorCode !== 'eg1') {
          // The client API key is not authorized for this request.
          throw new AppError("403-01", "403AA: server - CLIENT_AUTHORIZATION");
        }
      }
    } else if (isPushPath) {
      // The client API key is not authorized for this request.
      throw new AppError("403-01", "403AB: server - CLIENT_AUTHORIZATION");
    }
  }

  // if token is valid
  await next();
};

app.use("/*", cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }));

// Extend Context class
app.use("*", async (c: Context, next: Next) => {
  // add sendError method
  c.sendError = (appError: AppError) => {
    const resp = {
      error: appError.code,
      message: appError.getMessage(),
    };
    return c.body(
        JSON.stringify(resp, null, 2),
        appError.getHttpStatusCode() as ContentfulStatusCode,
        {
          "Content-Type": "application/json",
        },
    );
  };
  await next();
});

// url syntax validation middleware
app.use("*", async (c: Context, next: Next) => {
  const pathName = new URL(c.req.url).pathname;
  if (
    pathName.endsWith("/whereis/") ||
    pathName.endsWith("/whereis") ||
    pathName.endsWith("/status/") ||
    pathName.endsWith("/status")
  ) {
    throw new AppError("400-01", "400AC: server - TRACKING_ID");
  }
  await next();
});

app.use("/v0/whereis/:id", customBearerAuth);

app.use("/v0/push/:operator", customBearerAuth);

/**
 * GET /v0/status/:id? - Retrieves the status for a given tracking ID
 *
 * This endpoint handles GET requests to retrieve the status of a shipment based on its tracking ID.
 * It performs the following steps:
 * 1. Parses the URL to extract the tracking ID and any query parameters.
 * 2. Retrieves the status using the extracted information.
 * 3. Returns the status as a JSON response or an error if one occurs.
 *
 * @param c - The Hono context object containing request and response information.
 * @returns A Promise resolving to a Response object.
 *   - If successful, returns a 200 status code with the shipment status as pretty-printed JSON.
 *   - If an error occurs, returns an appropriate error response using the sendError method.
 *
 * Query Parameters:
 *   - id: The tracking ID of the shipment (optional, can be part of the URL path)
 *   - Additional carrier-specific parameters may be required (e.g., phonenum for sfex)
 *
 * Example usage:
 *   GET /v0/status/fdx-123456789
 *   GET /v0/status/sfex-987654321?phonenum=1234567890
 */
app.get("/v0/status/:id?", async (c: Context) => {
  const [trackingID, extraParams] = parseURL(c.req);

  const status = await getStatus(trackingID, extraParams);

  return c.body(JSON.stringify(status, null, 2), 200, {
    "Content-Type": "application/json; charset=utf-8",
  });
});

/**
 * GET /v0/whereis/:id - Retrieves location information for a tracking ID
 * Requires Bearer token authentication
 */
app.get("/v0/whereis/:id", async (c: Context) => {
  const start = performance.now();
  const [trackingID, extraParams, queryParams] = parseURL(c.req);

  const refresh = queryParams.refresh === "true";
  const fullData = queryParams.fulldata === "true";

  const entity: Entity | undefined = refresh
      ? await refreshEntityFromProvider(trackingID, extraParams)
      : await getEntityFromDbOrProvider(trackingID, extraParams);

  if (!entity) {
    throw new AppError("404-01", `404AA: Received empty data from source ${trackingID.operator}`);
  }

  const elapsed = performance.now() - start;
  const outputJSON = entity.toJSON(fullData) as {
    entity: { additional?: Record<string, unknown> };
  };

  // Set the processing time in the outputJSON
  if (!outputJSON.entity.additional) {
    outputJSON.entity.additional = {};
  }
  outputJSON.entity.additional.processingTimeMs = elapsed.toFixed(3);

  return c.json(outputJSON, 200, {
    "Content-Type": "application/json; charset=utf-8",
  });
});

/**
 * POST /v0/push/:operator - Receives tracking data from external sources
 *
 * This endpoint allows authenticated clients to push tracking information directly into the system.
 * It validates the operator, processes the incoming data, and stores it in the database.
 *
 * @param c - The Hono context object containing request and response information.
 * @returns A Promise resolving to a Response object.
 *
 * URL Parameters:
 *   - operator: The carrier/operator code (e.g., 'fdx', 'sfex')
 *
 * Request Body (JSON):
 *   - The structure depends on the operator. Different operators have different data structures.
 *   - For FedEx (fdx): Expects FedEx-specific tracking data format
 *   - For SF Express (sfex): Expects SF Express-specific tracking data format
 *   - Refer to operator-specific documentation for exact schema requirements
 */
app.post("/v0/push/:operator", async (c: Context) => {
  const operator = c.req.param("operator");
  // Validate operator
  if (!operator || !OperatorRegistry.getActiveOperatorCodes().includes(operator)) {
    throw new AppError("400-02", `400AG: server - INVALID_OPERATOR: ${operator}`);
  }

  // Parse request body
  let requestBody: Record<string, unknown>;
  try {
    requestBody = await c.req.json();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new AppError("400-04", `400AH: server - INVALID_JSON: ${errorMessage}`);
  }

  // Process valid data and convert to entities
  let entities: Entity[];
  let result: Record<string, unknown>;
  try {
    const processResult = await processPushData(operator, requestBody);
    entities = processResult.entities;
    result = processResult.result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new AppError("500-01", `500AA: server - DATA_PROCESSING_FAILED: ${errorMessage}`);
  }

  let updated = 0;
  let failed = 0;
  for (const entity of entities) {
    try {
      const eventIdsInDb: string[] = await dbClient.queryEventIds(
          TrackingID.parse(entity.id),
      );
      if (eventIdsInDb.length === 0) {
        const changes = await dbClient.insertEntity(entity);
        updated = updated + (changes ?? 0);
        if (changes !== undefined) updated = updated + 1;
      } else {
        // update the database on-demand
        const {dataChanged, eventIdsNew, eventIdsToBeRemoved} = entity.compare(eventIdsInDb);
        if (dataChanged) {
          const success = await dbClient.updateEntity(entity, "push", eventIdsNew, eventIdsToBeRemoved);
          if (success) updated = updated + 1;
        }
      }
    } catch (error) {
      failed = failed + 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to store entity ${entity.id}: ${errorMessage}`);
    }
  }

  result.updated = updated;
  result.failed = failed;
  return c.json(result, 200, {
    "Content-Type": "application/json; charset=utf-8",
  });
});

app.get("/operators", (c: Context) => {
  const output = {
    operators: OperatorRegistry.getActiveOperators(),
  };
  return c.json(output, 200, {
    "Content-Type": "application/json; charset=utf-8",
  });
});

/**
 * GET /web-health - Web health check endpoint
 */
app.get("/web-health", (c: Context) => {
  return c.html("UP"); // For empty slug, we should not return anything
});

/**
 * GET /app-health - App health check endpoint
 */
app.get("/app-health", async (c: Context) => {
  // Test the connection by executing a simple query
  const testResult = await dbClient.ping();
  if (testResult) {
    return c.text("UP", 200);
  }
  return c.text("DOWN", 503);
});

// error handling
app.onError((err: unknown, c: Context) => {
  if (err instanceof AppError) {
    const statusCode = err.getHttpStatusCode();
    if(statusCode < 500){
      logger.info(`Request URL: ${c.req.url}`);
      logger.info(`Error detail: ${err.getMessage()}`);
    } else {
      logger.error(`Request URL: ${c.req.url}`);
      logger.error(`Error detail: ${err.getMessage()}`);
    }
    return c.sendError(err);
  }

  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorStack = err instanceof Error ? err.stack : undefined;
  const errorCause = err instanceof Error ? err.cause : undefined;

  logger.error(`Request URL: ${c.req.url}`);
  logger.error(`Error detail: ${errorMessage}`);
  if (errorStack) logger.error(`Stack trace: ${errorStack}`);
  if (errorCause) logger.error(`Caused by: ${errorCause}`);

  return c.json({
    message: "Internal Server Error",
    code: "500",
  }, 500);
});

async function refreshEntityFromProvider(trackingID: TrackingID, parsedParams: Record<string, string>): Promise<Entity | undefined> {
  const entities = await requestWhereIs(trackingID.operator, [trackingID], parsedParams, "manual-pull");
  if (entities.length === 1) {
    await dbClient.refreshEntity(trackingID, entities[0] as Entity);
  }
  return entities.length === 0 ? undefined : entities[0];
}

async function getEntityFromDbOrProvider(trackingID: TrackingID, parsedParams: Record<string, string>): Promise<Entity | undefined> {
  let entity = await dbClient.queryEntity(trackingID);

  if(entity) {
    validateStoredEntity(trackingID.operator, entity, parsedParams);
  } else {
    const entities = await requestWhereIs(trackingID.operator, [trackingID], parsedParams, "manual-pull");
    if (entities.length === 1) {
      entity = entities[0];
      await dbClient.insertEntity(entity as Entity);
    }
  }

  return entity;
}

/**
 * Retrieves the status for a given tracking ID from the database or carrier.
 * This function first attempts to fetch the status from the database. If not found,
 * it requests the status from the data provider and updates the database accordingly.
 *
 * @param trackingID - The tracking ID object containing carrier and tracking number information.
 * @param queryParams - Additional query parameters, which may include carrier-specific information.
 * @returns A promise that resolves to:
 *          - The last important status of the entity if found.
 *          - An error code string if an error occurs (e.g., "400-03" for mismatched phone number).
 *          - undefined if no status is found.
 * @throws Will throw an error if there's an issue with database operations.
 */
async function getStatus(
  trackingID: TrackingID,
  queryParams: Record<string, string>,
): Promise<Record<string, unknown> | undefined> {
  // Try to get entity from database first
  const entity = await dbClient.queryEntity(trackingID);
  if (entity) {
    if (
      trackingID.operator === "sfex" &&
      entity.params?.phonenum !== queryParams.phonenum
    ) {
      throw new AppError("400-03", "400AE: sfex - PHONENUM");
    }
    return entity.getLastStatus();
  }

  // If not in database, request from data provider
  const result: Entity[] = await requestWhereIs(
    trackingID.operator,
    [trackingID],
    queryParams,
    "manual-pull",
  );

  if (result.length === 0) {
    throw new AppError("404-01", `404AB: Received empty data from source ${trackingID.operator}`); // Not found in data provider
  }

  await dbClient.insertEntity(result[0] as Entity);

  return (result[0] as Entity).getLastStatus();
}

/**
 * Parses the URL from the request to extract tracking information and query parameters.
 * It validates the presence of required parameters for specific operators, such as 'phonenum' for 'sfex'.
 *
 * @param req - The Hono request object containing the URL and parameters.
 * @returns A tuple containing the parsed `TrackingID` object and a record of extracted query parameters.
 * @throws {AppError} Throws an `AppError` if the tracking ID format is invalid or if required
 *   parameters for a specific operator are missing (e.g., 'phonenum' for 'sfex').
 */
function parseURL(req: HonoRequest): [TrackingID, Record<string, string>, Record<string, string>] {
  // Carrier-TrackingNumber
  const id = req.param("id") ?? "";
  const trackingID = TrackingID.parse(id);

  const queryParams = req.query();
  const operator: string = trackingID.operator;
  const extraParams = getExtraParams(operator, req);

  const success = validateParams(operator, trackingID, extraParams);
  if(success) {
    const validParamsSet: string[] = ApiParams.getParamNames("whereis", trackingID.operator);
    const invalidParams = validateQueryParams(queryParams, new Set(validParamsSet));
    if (invalidParams.length > 0) {
      throw new AppError("400-03", "400AA: server - " + invalidParams.join(","));
    }
  }

  return [trackingID, extraParams, queryParams];
}

function validateQueryParams(params: Record<string, string>, validParams?: Set<string>,): string[] {
  const invalidParams: string[] = [];

  Object.keys(params).forEach((key) => {
    if (validParams === undefined || !validParams.has(key)) {
      invalidParams.push(key);
    }
  });

  return invalidParams;
}

// Export the Hono app instance
export { app };