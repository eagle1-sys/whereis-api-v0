/**
 * @file Server.ts
 * @description Implements a Hono-based server for tracking package status and location information.
 * Handles HTTP requests, database operations, and carrier API integrations with Bearer token authentication.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { Context, Hono, HonoRequest, Next } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { cors } from "hono/cors";
import { dbClient} from "./main.ts";
import { logger } from "../tools/logger.ts";
import { isOperatorActive, requestWhereIs } from "./gateway.ts";
import {
  ApiParams,
  Entity,
  OperatorRegistry,
  TrackingID,
  AppError,
} from "./model.ts";

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

  if (token === "eagle1") {
    // Extract tracking ID from the URL
    const trackingId = c.req.param("id") ?? "";
    const idx = trackingId.trim().indexOf("-");
    if (idx > 0) {
      const operatorCode = trackingId.substring(0, idx);
      if (isOperatorActive(operatorCode)) {
        // The client API key is not authorized for this request.
        throw new AppError("403-01","403AA: server - CLIENT_AUTHORIZATION");
      }
    }
  }

  // if token is valid
  await next();
};

app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

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
  const [trackingID, parsedParams] = parseURL(c.req);
  const queryParams = c.req.query();

  const validParams: string[] = ApiParams.getParamNames(
    "status",
    trackingID.operator,
  );
  const validParamSet = new Set(validParams);
  const invalidParams = validateQueryParams(queryParams, validParamSet);

  if (invalidParams.length > 0) {
    return c.sendError(new AppError("400-03", "400AB: server - " + invalidParams.join(",")));
  }

  const status = await getStatus(trackingID, parsedParams);

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
  const [trackingID, parsedParams] = parseURL(c.req);
  const queryParams = c.req.query();
  // Validate query parameters
  const validParamsSet: string[] = ApiParams.getParamNames(
    "whereis",
    trackingID.operator,
  );
  const invalidParams = validateQueryParams(
    queryParams,
    new Set(validParamsSet),
  );
  if (invalidParams.length > 0) {
    return c.sendError(new AppError("400-03", "400AA: server - " + invalidParams.join(",")));
  }

  const refresh = queryParams.refresh === "true";
  const fullData = queryParams.fulldata === "true";

  const entity: Entity | undefined = refresh
    ? await refreshEntityFromProvider(trackingID, parsedParams)
    : await getEntityFromDbOrProvider(
      trackingID,
      parsedParams,
      queryParams,
    );

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
  if (testResult === 1) {
    return c.html("UP");
  }
  return c.html("Failed");
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

async function refreshEntityFromProvider(
  trackingID: TrackingID,
  parsedParams: Record<string, string>,
): Promise<Entity | undefined> {
  const entities = await requestWhereIs(
    trackingID.operator,
    [trackingID],
    parsedParams,
    "manual-pull",
  );
  if (entities.length === 1) {
    await dbClient.refreshEntity(trackingID, entities[0] as Entity);
  }
  return entities.length === 0 ? undefined : entities[0];
}

async function getEntityFromDbOrProvider(
  trackingID: TrackingID,
  parsedParams: Record<string, string>,
  queryParams: Record<string, string>,
): Promise<Entity | undefined> {
  let entity = await dbClient.queryEntity(trackingID);

  if (!entity) {
    const entities = await requestWhereIs(
      trackingID.operator,
      [trackingID],
      parsedParams,
      "manual-pull",
    );
    if (entities.length === 1) {
      entity = entities[0];
      await dbClient.insertEntity(entity as Entity);
    }
  } else if (
    trackingID.operator === "sfex" &&
    entity.params?.phonenum !== queryParams.phonenum
  ) {
    throw new AppError("400-03", "400AD: sfex - PHONENUM");
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

  try {
    await dbClient.insertEntity(result[0] as Entity);
  } catch (error) {
    throw error;
  }
  return (result[0] as Entity).getLastStatus();
}

/**
 * Parses the URL from the request to extract tracking information and query parameters.
 *
 * @param req - The Hono request object containing the URL and parameters.
 * @returns A tuple containing:
 *   - A string representing an error code (empty if no error).
 *   - A TrackingID object (undefined if parsing fails).
 *   - A Record of additional query parameters (undefined if parsing fails).
 */
function parseURL(
  req: HonoRequest,
): [TrackingID, Record<string, string>] {
  // Carrier-TrackingNumber
  const id = req.param("id") ?? "";
  const trackingID = TrackingID.parse(id);

  const queryParams = getExtraParams(
    req,
    trackingID.operator,
  );

  if (trackingID.operator == "sfex") {
    const phoneNum = queryParams["phonenum"];
    if (phoneNum == undefined || phoneNum == "") {
      throw new AppError("400-03", "400AF: sfex - PHONENUM");
    }
  }

  return [trackingID, queryParams];
}

/**
 * Extracts extra parameters based on carrier type
 * @param req - The request object
 * @param operator - The carrier identifier
 * @returns Record of extra parameters
 */
function getExtraParams(
  req: HonoRequest,
  operator: string,
): Record<string, string> {
  if ("sfex" == operator) {
    return { phonenum: req.query("phonenum") ?? "" };
  }
  return {};
}

function validateQueryParams(
  params: Record<string, string>,
  validParams?: Set<string>,
): string[] {
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
