/**
 * @file Server.ts
 * @description Implements a Hono-based server for tracking package status and location information.
 * Handles HTTP requests, database operations, and carrier API integrations with Bearer token authentication.
 * @author samshdn
 * @version 0.1.1
 * @date 2025-02-28
 */

import { Context, Hono, Next } from "hono";
import { StatusCode } from "hono/utils/http-status";
import { QueryArrayResult } from "https://deno.land/x/postgres/mod.ts";

import { logger } from "./logger.ts";
import { connect } from "./database/dbutil.ts";
import { requestWhereIs } from "./gateway.ts";
import { Entity, ErrorRegistry, TrackingID } from "./model.ts";
import {
    insertEntity,
    queryEntity,
    queryEventIds,
    queryStatus,
    updateEntity,
} from "./database/dbop.ts";

declare module "hono" {
    // noinspection JSUnusedGlobalSymbols
    interface Context {
        /**
         * Sends an error response with specified error code and message
         * @param errorCode - The error code in format "HTTPSTATUS-CODE"
         * @returns Response object with JSON error payload
         */
        sendError: (errorCode: string) => Response;
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
     * Verifies if the provided token is valid
     * @param token - The Bearer token to verify
     * @returns boolean indicating if token is valid
     */
    verifyToken(token: string): boolean {
        return token == "eagle1";
    }

    /**
     * Extracts HTTP status code from error code string
     * @param errorCode - Error code in format "HTTPSTATUS-CODE"
     * @returns Numeric HTTP status code
     * @throws Error if errorCode format is invalid
     */
    getHttpCode(errorCode: string): number {
        const parts = errorCode.split("-");
        const httpStatusCode = Number(parts[0]);
        // validate the first part
        if (isNaN(httpStatusCode)) {
            throw new Error("Invalid parameter");
        }

        return httpStatusCode;
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
                return c.sendError("401-01");
            }

            const token = authHeader.split(" ")[1];
            const isValidToken = this.verifyToken(token); // 你需要实现这个函数
            if (!isValidToken) {
                return c.sendError("401-02");
            }

            // if token is valid
            await next();
        };

        // Extend Context class
        app.use("*", async (c, next) => {
            // Extend Context，add sendMyJSON method
            c.sendError = (code: string) => {
                return c.json(
                    {
                        code: code,
                        message: ErrorRegistry.getMessage(code),
                    },
                    this.getHttpCode(code) as StatusCode, // unAuthorized
                );
            };
            await next();
        });

        app.use("/v0/whereis/:id", customBearerAuth);

        /**
         * GET /v0/status/:id - Retrieves status for a tracking ID
         */
        app.get("/v0/status/:id?", async (c) => {
            // Carrier-TrackingNumber
            const id = c.req.param("id") ?? "";
            const [error, trackingID] = TrackingID.parse(id);
            if (trackingID == undefined) {
                const errorCode = error ?? "";
                return c.sendError(errorCode);
            }

            const queryParams = this.getExtraParams(
                c.req,
                trackingID.carrier,
            );

            // query DB to get the status
            const status = await this.getStatus(trackingID, queryParams);
            if (status == undefined) {
                return c.sendError("404-01");
            } else {
                return c.json(status);
            }
        });

        /**
         * GET /v0/whereis/:id - Retrieves location information for a tracking ID
         * Requires Bearer token authentication
         */
        app.get("/v0/whereis/:id?", async (c) => {
            // Carrier-TrackingNumber
            const id = c.req.param("id") ?? "";
            const [error, trackingID] = TrackingID.parse(id);
            if (trackingID == undefined) {
                const errorCode = error ?? "";
                return c.sendError(errorCode);
            }

            const queryParams = this.getExtraParams(
                c.req,
                trackingID.carrier,
            );

            // get the full url string
            let entity: Entity | undefined;
            const fullData: boolean = "true" == c.req.query("fulldata");

            if (c.req.param("refresh") === undefined) {
                entity = await this.getObjectFromDbFirst(
                    trackingID,
                    queryParams,
                );
            } else {
                // issue request to carrier
                entity = await this.getObjectFromCarrierFirst(
                    trackingID,
                    queryParams,
                );
            }

            if (entity === undefined) {
                // Not found
                return c.sendError("404-01");
            } else {
                // send response
                return c.json(entity.toJSON(fullData));
            }
        });

        app.get("/dbtest", async (c) => {
            let result: QueryArrayResult | undefined;
            // Init db client
            try {
                using client = await connect();
                result = await client.queryArray`SELECT now()`;
            } catch (error) {
                logger.error(`Database operation failed: ${error}`);
            }
            if (result === undefined) {
                c.notFound();
            } else {
                return c.text(String(result.rows[0][0]));
            }
        });

        /**
         * GET / - Root endpoint
         */
        app.get("/", (c) => {
            throw new Error('Something went wrong!')
            // return c.html("<h3>Hello Eegle1!</h3>");
        });

        // error handling
        app.onError((err, c) => {
            logger.error("Internal Server Error:", err);
            return c.json({
                message: "Internal Server Error",
                error: err.message,
            }, 500);
        });

        Deno.serve({ port: this.port }, app.fetch);
    }

    /**
     * Stops the server (currently just logs message)
     */
    stop(): void {
        console.log(`Server is stopping...`);
    }

    /**
     * Retrieves status for a tracking ID from DB or carrier
     * @param trackingID - The tracking ID object
     * @param queryParams - Additional query parameters
     * @returns Status object or undefined if not found
     */
    async getStatus(
        trackingID: TrackingID,
        queryParams: Record<string, string>,
    ) {
        let client;
        let status;
        let entity: Entity | undefined;
        try {
            client = await connect();
            // try to load from database first
            status = await queryStatus(client, trackingID);
            if (status != undefined) {
                return status;
            }

            entity = await requestWhereIs(
                trackingID,
                queryParams,
                "manual-pull",
            );
            if (entity != undefined) {
                client.queryObject("BEGIN");
                await insertEntity(client, entity);
                client.queryObject("COMMIT");
                status = entity.getLastStatus();
            }
        } catch (error) {
            logger.error(error);
            if (client) {
                client.queryObject("ROLLBACK");
            }
        } finally {
            if (client) {
                client.release();
            }
        }

        return status;
    }

    /**
     * Attempts to get entity from database first, then carrier if not found
     * @param trackingID - The tracking ID object
     * @param queryParams - Additional query parameters
     * @returns Entity object or undefined if not found
     */
    async getObjectFromDbFirst(
        trackingID: TrackingID,
        queryParams: Record<string, string>,
    ) {
        let client;
        let entity: Entity | undefined;
        try {
            client = await connect();

            // try to load from database first
            entity = await queryEntity(client, trackingID);
            if (entity !== undefined) {
                return entity;
            }

            entity = await requestWhereIs(
                trackingID,
                queryParams,
                "manual-pull",
            );
            if (entity != undefined) {
                client.queryObject("BEGIN");
                await insertEntity(client, entity);
                client.queryObject("COMMIT");
            }
        } catch (error) {
            logger.error(error);
            if (client) {
                client.queryObject("ROLLBACK");
            }
        } finally {
            if (client) {
                client.release();
            }
        }

        return entity;
    }

    /**
     * Gets entity from carrier first and updates database
     * @param trackingID - The tracking ID object
     * @param queryParams - Additional query parameters
     * @returns Entity object or undefined if not found
     */
    async getObjectFromCarrierFirst(
        trackingID: TrackingID,
        queryParams: Record<string, string>,
    ) {
        // load from carrier
        const entity: Entity | undefined = await requestWhereIs(
            trackingID,
            queryParams,
            "manual-pull",
        );

        if (entity === undefined) {
            return entity;
        }

        // update to database
        let client;
        try {
            client = await connect();
            const eventIds: string[] = await queryEventIds(
                client,
                trackingID,
            );
            if (entity != undefined && entity.eventNum() > eventIds.length) {
                // update the entity
                client.queryObject("BEGIN");
                await updateEntity(client, entity, eventIds);
                client.queryObject("COMMIT");
            }
        } catch (error) {
            logger.error(error);
            if (client) {
                client.queryObject("ROLLBACK");
            }
        } finally {
            if (client) {
                client.release();
            }
        }

        return entity;
    }

    /**
     * Extracts extra parameters based on carrier type
     * @param req - The request object
     * @param carrier - The carrier identifier
     * @returns Record of extra parameters
     */
    getExtraParams(req: any, carrier: string): Record<string, string> {
        if ("sfex" == carrier) {
            return { phonenum: req.query("phonenum") };
        }
        return {};
    }
}
