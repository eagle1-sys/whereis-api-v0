/**
 * @file Fedex.ts
 * @description A TypeScript class implementation for interacting with the FedEx tracking API.
 *              Provides functionality to authenticate with the API, fetch shipment tracking details,
 *              and convert FedEx tracking data into an internal Entity format with associated events.
 * @author samshdn
 * @version 0.1.1
 * @date 2025-02-28
 * @requires axios - For making HTTP requests to the FedEx API
 * @requires ./logger.ts - For logging errors and debugging
 * @requires ./model.ts - For Entity, Event, and CodeDesc type definitions
 * @requires ./util.ts - For jsonToMd5 utility function
 * @dependencies
 *   - Deno environment variables: FedEx_API_URL, FedEx_Client_ID, FedEx_Client_Secret, FedEx_Track_API_URL
 *   - External crypto API for UUID generation
  * @example
 *   const trackingInfo = await Fedex.whereIs("123456789012", "manual");
 *   console.log(trackingInfo);
 */

import axios from "axios";
import { logger } from "../logger.ts";
import { jsonToMd5 } from "../util.ts";
import { CodeDesc, Entity, Event } from "../model.ts";

/**
 * A class to interact with the FedEx tracking API and manage shipment tracking information.
 */
export class Fedex {
    /** @type {string} The current authentication token for FedEx API requests. */
    private static token: string;
    /** @type {number} The expiration time of the token in milliseconds since epoch. Initially 0. */
    private static expireTime: number = 0;
    /**
     * A mapping of FedEx status codes and event types to internal event codes or functions.
     * @type {Record<string, Record<string, any>>}
     */
    private static eventCodeMap: Record<string, Record<string, any>> = {
        IN: {
            OC: 3000, // Transport Bill Created
        },
        IT: {
            DR: 3250, // In-Transit
            DP: 3004, // Logistics In-Progress
            AR: 3002, // Arrived
            IT: 3001, // Logistics In-Progress
            AF: 3001, // Logistics In-Progress
            CC: function (sourceData: Record<string, any>): number {
                const desc = sourceData["eventDescription"];
                if (desc.indexOf("Export") > 0) {
                    return 3200; // Customs Clearance: Export Released
                } else if (desc.indexOf("Import") > 0) {
                    return 3400; // Customs Clearance: Import Released
                }
                return -1;
            },
            OD: 3450, // Final Delivery In-Progress
        },
        CD: {
            CD: 3150, // Clearance delay - Import
        },
        PU: {
            PU: 3050, // Picked up
        },
        DL: {
            DL: 3500, // Delivered
        },
    };

    /**
     * Retrieves the internal event code based on FedEx status code, event type, and source data.
     * @param {string} derivedStatusCode - The derived status code from FedEx.
     * @param {string} eventType - The type of event from FedEx.
     * @param {Record<string, any>} sourceData - The raw event data from FedEx.
     * @returns {number} The corresponding internal event code, or -1 if not found.
     */
    static getEventCode(
        derivedStatusCode: string,
        eventType: string,
        sourceData: Record<string, any>,
    ): number {
        if (derivedStatusCode in Fedex.eventCodeMap) {
            const value = Fedex.eventCodeMap[derivedStatusCode][eventType];
            if (typeof value === "number") {
                return value;
            } else if (typeof value === "function") {
                return value(sourceData);
            }
        }
        return -1;
    }

    /**
     * Constructs a location string from a scan location object.
     * @param {Record<string, unknown>} scanLocation - The scan location data.
     * @returns {string} A formatted string representing the location (e.g., "City State Country").
     */
    static getWhere(scanLocation: Record<string, unknown>): string {
        return (scanLocation["city"] ?? "") + " " +
            (scanLocation["stateOrProvinceCode"] ?? "") + " " +
            (scanLocation["countryName"] ?? "");
    }

    /**
     * Constructs an address string from an address object.
     * @param {Record<string, unknown>} address - The address data.
     * @returns {string} A formatted string representing the address (e.g., "City State Country").
     */
    static getAddress(address: Record<string, unknown>): string {
        return (address["city"] ?? "") + " " +
            (address["stateOrProvinceCode"] ?? "") + " " +
            address["countryName"];
    }

    /**
     * Retrieves the current location and tracking details for a given tracking number.
     * @param {string} trackingNum - The FedEx tracking number.
     * @param {string} updateMethod - The method used to update the tracking information.
     * @returns {Promise<Entity | undefined>} A promise resolving to the tracking entity or undefined if not found.
     */
    static async whereIs(
        trackingNum: string,
        updateMethod: string,
    ): Promise<Entity | undefined> {
        const result = await this.getRoute(trackingNum);
        if (result === undefined) return undefined;

        return await this.convert(trackingNum, result, updateMethod);
    }

    /**
     * Fetches and manages the FedEx API authentication token.
     * @returns {Promise<string>} A promise resolving to the current or newly fetched token.
     * @throws {Error} If the token cannot be retrieved from the FedEx API.
     */
    static async getToken(): Promise<string> {
        // Refresh the token 5 seconds before expiration.
        if (Date.now() > this.expireTime - 5000) {
            const fedEx_API_URL: string = Deno.env.get("FedEx_API_URL") ?? "";
            const fedEx_Client_ID: string = Deno.env.get("FedEx_Client_ID") ??
                "";
            const fedEx_Client_Secret: string =
                Deno.env.get("FedEx_Client_Secret") ?? "";
            try {
                const response = await axios.post(fedEx_API_URL, {
                    grant_type: "client_credentials",
                    client_id: fedEx_Client_ID,
                    client_secret: fedEx_Client_Secret,
                }, {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                });
                this.token = response.data.access_token;
                this.expireTime = Date.now() + response.data.expires_in * 1000;
            } catch (error) {
                console.error("Could not get JSON:", error);
                throw error;
            }
        }

        if (this.expireTime > 0) {
            return this.token;
        } else {
            return "";
        }
    }

    /**
     * Fetches the shipment route details for a given tracking number from the FedEx API.
     * @param {string} trackingNumber - The FedEx tracking number.
     * @returns {Promise<Record<string, any>>} A promise resolving to the raw API response data.
     * @throws {Error} If the API request fails.
     */
    static async getRoute(
        trackingNumber: string,
    ): Promise<Record<string, any>> {
        try {
            // Prepare the request payload
            const payload = {
                "includeDetailedScans": true,
                "trackingInfo": [
                    {
                        "trackingNumberInfo": {
                            "trackingNumber": trackingNumber,
                        },
                    },
                ],
            };

            // Send the API request
            const token = await this.getToken();
            const FedEx_Track_API_URL: string =
                Deno.env.get("FedEx_Track_API_URL") ?? "";
            const response = await axios.post(FedEx_Track_API_URL, payload, {
                headers: {
                    "Content-Type": "application/json",
                    "X-locale": "en_US",
                    "Authorization": "Bearer " + token,
                },
            });

            return response.data;
        } catch (error) {
            logger.error("Error fetching shipment details:", error);
            throw error;
        }
    }

    /**
     * Converts raw FedEx API data into an internal Entity object with events.
     * @param {string} trackingNum - The FedEx tracking number.
     * @param {Record<string, any>} result - The raw API response data.
     * @param {string} updateMethod - The method used to update the tracking information.
     * @returns {Promise<Entity>} A promise resolving to the constructed Entity object.
     * @private
     */
    private static async convert(
        trackingNum: string,
        result: Record<string, any>,
        updateMethod: string,
    ): Promise<Entity> {
        const entity: Entity = new Entity();
        const completeTrackResult = result["output"]["completeTrackResults"][0];
        const trackResult = completeTrackResult["trackResults"][0];
        entity.uuid = "eg1_" + crypto.randomUUID();
        entity.id = trackingNum;
        entity.params = {};
        entity.type = "waybill";
        entity.extra = {
            origin: Fedex.getAddress(
                trackResult["shipperInformation"]["address"],
            ),
            destination: Fedex.getAddress(
                trackResult["recipientInformation"]["address"],
            ),
        };

        const scanEvents = trackResult["scanEvents"];
        for (let i = scanEvents.length - 1; i >= 0; i--) {
            const event = new Event();
            const scanEvent = scanEvents[i];
            const fdxStatusCode = scanEvent["derivedStatusCode"];
            const fdxEventType = scanEvent["eventType"];
            const eagle1status: number = Fedex.getEventCode(
                fdxStatusCode,
                fdxEventType,
                scanEvent,
            );
            const eventId = "ev_" + await jsonToMd5(scanEvent);
            if (entity.isEventIdExist(eventId)) continue;

            event.eventId = eventId;
            event.operatorCode = "fdx";
            event.trackingNum = completeTrackResult["trackingNumber"];
            event.status = eagle1status;
            event.what = CodeDesc.getDesc(eagle1status);
            event.when = scanEvent["date"];
            const where = Fedex.getWhere(scanEvent["scanLocation"]);
            if (where.trim().length > 0) {
                event.where = where;
            } else {
                if (scanEvent["locationType"] == "CUSTOMER") {
                    event.where = "Customer location";
                }
            }
            event.whom = "FedEx";
            event.notes = scanEvent["eventDescription"];
            event.dataProvider = "FedEx";
            event.extra = {
                lastUpdateMethod: updateMethod,
                lastUpdateTime: new Date().toISOString(),
            };
            event.sourceData = scanEvent;
            entity.addEvent(event as Event);
        }
        return entity;
    }
}
