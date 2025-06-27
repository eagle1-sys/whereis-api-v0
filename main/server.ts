/**
 * @file Server.ts
 * @description Implements a Hono-based server for tracking package status and location information.
 * Handles HTTP requests, database operations, and carrier API integrations with Bearer token authentication.
 */

import postgres from "postgresjs";
import { Context, Hono, HonoRequest, Next } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { cors } from "hono/cors";
import { sql } from "../db/dbutil.ts";
import { logger } from "../tools/logger.ts";
import { deleteEntity, isTokenValid } from "../db/dbop.ts";
import { requestWhereIs } from "./gateway.ts";
import { Entity, ErrorRegistry, TrackingID, UserError } from "./model.ts";
import { insertEntity, queryEntity } from "../db/dbop.ts";

declare module "hono" {
  // noinspection JSUnusedGlobalSymbols
  interface Context {
    /**
     * Sends an error response with specified error code and message
     * @param errorCode - The error code in format "HTTPSTATUS-CODE"
     * @returns Response object with JSON error payload
     */
    sendError: (errorCode: string, params?: Record<string, string>) => Response;
  }
}

/**
 * Server class that manages HTTP endpoints for tracking services
 */
export class Server {
  private readonly port: number;

  /**
   * Creates a new Server instance
   * @param port - The port number to run the server on
   */
  constructor(port: number) {
    this.port = port;
  }

  /**
   * Starts the HTTP server with configured routes
   */
  start(): void {
    const app = new Hono();

    // Bearer Auth middleware
    const customBearerAuth = async (c: Context, next: Next) => {
      const authHeader = c.req.header("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new UserError("401-01");
      }

      const token = authHeader.split(" ")[1];
      const isValidToken = await this.verifyToken(token); // verify the token
      if (!isValidToken) {
        throw new UserError("401-02");
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
      c.sendError = (code: string, params?: Record<string, string>) => {
        return this.sendError(c, code, params);
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
        throw new UserError("400-01");
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
      const [trackingID, parsedParams] = this.parseURL(c.req);
      const queryParams = c.req.query();

      const validParamsConfig: Record<string, string[]> = {
        fdx: [],
        sfex: ["phonenum"],
      };
      const validParams = new Set(validParamsConfig[trackingID.operator] || []);
      const invalidParams = this.validateQueryParams(queryParams, validParams);

      if (invalidParams.length > 0) {
        return c.sendError("400-07", { param: invalidParams.join(",") });
      }

      const status = await this.getStatus(trackingID, parsedParams);

      return c.body(JSON.stringify(status, null, 2), 200, {
        "Content-Type": "application/json; charset=utf-8",
      });
    });

    /**
     * GET /v0/whereis/:id - Retrieves location information for a tracking ID
     * Requires Bearer token authentication
     */
    app.get("/v0/whereis/:id", async (c: Context) => {
      const [trackingID, parsedParams] = this.parseURL(c.req);
      const queryParams = c.req.query();

      const validParamsSet = new Set(["fulldata", "refresh", ...(trackingID.operator === "sfex" ? ["phonenum"] : [])]);
      const invalidParams = this.validateQueryParams(queryParams, validParamsSet);

      if (invalidParams.length > 0) {
        return c.sendError("400-07", { param: invalidParams.join(",") });
      }

      const refresh = queryParams.refresh === "true";
      const fullData = queryParams.fulldata === "true";

      const result = refresh
          ? await this.getEntityFromProviderFirst(trackingID, parsedParams)
          : await this.getEntityFromDatabaseFirst(trackingID, parsedParams);

      if (result instanceof Entity) {
        // send response
        return c.json(result.toJSON(fullData), 200, {
          "Content-Type": "application/json; charset=utf-8",
        });
      } else {
        // send error
        logger.error(`Entity not found for tracking ID: ${trackingID}`);
        return c.sendError("404-01");
      }
    });

    /**
     * GET /apistatus - Health check endpoint
     */
    app.get("/apistatus", (c: Context) => {
      return c.html(""); // For empty slug, we should not return anything
    });

    // error handling
    app.onError((err: unknown, c: Context) => {
      if (err instanceof UserError) {
        return c.sendError(err.code);
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      const errorCause = err instanceof Error ? err.cause : undefined;

      logger.error(`Error on URL: ${c.req.url}`);
      logger.error(`Error message: ${errorMessage}`);
      if (errorStack) logger.error(`Stack trace: ${errorStack}`);
      if (errorCause) logger.error(`Caused by: ${errorCause}`);

      return c.json({
        message: "Internal Server Error",
        code: "500",
      }, 500);
    });

    Deno.serve({ port: this.port }, app.fetch);
  }


  private validateQueryParams(
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
  private async getStatus(
    trackingID: TrackingID,
    queryParams: Record<string, string>,
  ): Promise<Record<string, unknown> | undefined> {
    // Try to get entity from database first
    const entity = await queryEntity(sql, trackingID);
    if (entity) {
      if (
        trackingID.operator === "sfex" &&
        entity.params?.phonenum !== queryParams.phonenum
      ) {
        throw new UserError("400-06");
      }
      return entity.getLastStatus();
    }

    // If not in database, request from data provider
    const result = await requestWhereIs(
      trackingID,
      queryParams,
      "manual-pull",
    );

    if (result === undefined) {
      logger.error(`Context: getStatus`);
      throw new UserError("404-01"); // Not found in data provider
    }

    try {
      await sql.begin(async (sql: ReturnType<typeof postgres>) => {
        await insertEntity(sql, result);
        return true;
      });
    } catch (error) {
      throw error;
    }
    return result.getLastStatus();
  }

  /**
   * Attempts to get object from database first, then carrier if not found
   * @param trackingID - The tracking ID object
   * @param queryParams - Additional query parameters
   * @returns An Entity object on success or a string error code if an error occurs
   */
  private async getEntityFromDatabaseFirst(
    trackingID: TrackingID,
    queryParams: Record<string, string>,
  ) {
    let entity: Entity | undefined;
    try {
      // try to load from database first
      const entityInDB: Entity | undefined = await queryEntity(
        sql,
        trackingID,
      );
      if (entityInDB !== undefined) {
        if (
          trackingID.operator === "sfex" &&
          entityInDB.params &&
          entityInDB.params["phonenum"] !== queryParams["phonenum"]
        ) {
          throw new UserError("400-06");
        }
        return entityInDB;
      }

      entity = await requestWhereIs(
        trackingID,
        queryParams,
        "manual-pull",
      );
      if (entity instanceof Entity) {
        try {
          await sql.begin(async (sql: ReturnType<typeof postgres>) => {
            await insertEntity(sql, entity as Entity);
          });
        } catch (err) {
          throw err;
        }
      }
    } finally {
      //await sql.end();
    }
    return entity;
  }

  /**
   * Gets object from data provider first and updates database
   * @param trackingID - The tracking ID object
   * @param queryParams - Additional query parameters
   * @returns An Entity object on success or a string error code if an error occurs
   */
  private async getEntityFromProviderFirst(
    trackingID: TrackingID,
    queryParams: Record<string, string>,
  ): Promise<Entity> {
    // load from carrier
    const entity: Entity | undefined = await requestWhereIs(
      trackingID,
      queryParams,
      "manual-pull",
    );

    // The refresh has failed to receive data from the data provider.
    if (entity === undefined) {
      throw new UserError("404-03");
    }

    // update to database
    try {
      await sql.begin(async (sql: ReturnType<typeof postgres>) => {
        // step 1: delete the existing record first
        await deleteEntity(sql, trackingID);
        // step 2: insert into database
        await insertEntity(sql, entity);
        return true;
      });
    } catch (error) {
      throw error;
    } finally {
      //await sql.end();
    }

    return entity;
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
  private parseURL(
    req: HonoRequest,
  ): [TrackingID, Record<string, string>] {
    // Carrier-TrackingNumber
    const id = req.param("id") ?? "";
    const trackingID = TrackingID.parse(id);

    const queryParams = this.getExtraParams(
      req,
      trackingID.operator,
    );

    if (trackingID.operator == "sfex") {
      const phoneNum = queryParams["phonenum"];
      if (phoneNum == undefined || phoneNum == "") {
        throw new UserError("400-03");
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
  private getExtraParams(
    req: HonoRequest,
    operator: string,
  ): Record<string, string> {
    if ("sfex" == operator) {
      return { phonenum: req.query("phonenum") ?? "" };
    }
    return {};
  }

  /**
   * Verifies if the provided token is valid
   * @param token - The Bearer token to verify
   * @returns boolean indicating if token is valid
   */
  private async verifyToken(token: string): Promise<boolean> {
    return await isTokenValid(sql, token);
  }

  /**
   * Extracts HTTP status code from error code string
   * @param errorCode - Error code in format "HTTPSTATUS-CODE"
   * @returns Numeric HTTP status code
   * @throws Error if errorCode format is invalid
   */
  private getHttpStatusCode(errorCode: string): number {
    const parts = errorCode.split("-");
    const httpStatusCode = Number(parts[0]);
    // validate the first part
    if (isNaN(httpStatusCode)) {
      throw new Error("Invalid parameter");
    }

    return httpStatusCode;
  }

  private sendError(c: Context, code: string, params?: Record<string, string>): Response {
    const resp = {
      error: code,
      message: ErrorRegistry.getMessage(code, params),
    };
    return c.body(
        JSON.stringify(resp, null, 2),
        this.getHttpStatusCode(code) as ContentfulStatusCode,
        {
          "Content-Type": "application/json",
        },
    );
  }

}
