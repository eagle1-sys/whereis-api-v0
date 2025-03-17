/**
 * @fileoverview SF Express (Sfex) API client for tracking shipments and converting route data.
 * This module provides functionality to interact with the SF Express API, retrieve shipment routes,
 * and convert them into a structured `Entity` object with associated `Event` details.
 * @module Sfex
 * @requires axios
 * @requires node:crypto
 * @requires ./logger.ts
 * @requires ./model.ts
 * @requires ./util.ts
 * @author samshdn
 * @version 0.1.1
 * @date 2025-02-28
 */

import axios from "axios";

import { createHash } from "node:crypto";
import { logger } from "../logger.ts";
import { jsonToMd5 } from "../util.ts";
import { CodeDesc, Entity, Event } from "../model.ts";

/**
 * SF Express API client class for tracking shipments and managing route data.
 */
export class Sfex {

    /**
     * Mapping of SF Express status codes and operation codes to internal event codes.
     * @private
     * @static
     * @type {Record<string, Record<string, number>>}
     */
    private static eventCodeMap: Record<string, Record<string, number>> = {
        "101": {
            "54": 3100,     // Received by Carrier
        },
        "201": {
            "30": 3001,     // Logistics In-Progress
            "31": 3002,     // Arrived
            "36": 3004,     // Departed
            "105": 3250,    // In-Transit
            "106": 3300,    // Arrived At Destination
            "310": 3002,    // Customs Clearance: Import Released
        },
        "204": {
            "605": 3350,    // Customs Clearance: Import In-Progress
        },
        "301": {
            "44": 3001,     // Logistics In-Progress
            "204": 3450,    // Final Delivery In-Progress
        },
        "1301": {
            "70": 3300,     // Arrived At Destination
        },
        "401": {
            "80": 3500,     // Delivered
        }
    };

    /**
     * Retrieves the internal event code based on SF Express status and operation codes.
     * @static
     * @param {string} statusCode - The SF Express status code.
     * @param {string} opCode - The SF Express operation code.
     * @returns {number} The corresponding internal event code, or -1 if not found.
     */
    static getEventCode(
        statusCode: string,
        opCode: string,
    ): number {
        if (statusCode in Sfex.eventCodeMap) {
            return Sfex.eventCodeMap[statusCode][opCode];
        }
        return -1;
    }

    /**
     * Queries the location and status of a shipment using its tracking number.
     * @static
     * @async
     * @param {string} trackingNum - The tracking number of the shipment.
     * @param {Record<string, string>} extraParams - Additional parameters, including phone number.
     * @param {string} updateMethod - The method used to update the tracking information.
     * @returns {Promise<Entity | undefined>} A promise that resolves to an `Entity` object or undefined if no data is found.
     */
    static async whereIs(
        trackingNum: string,
        extraParams: Record<string, string>,
        updateMethod: string,
    ): Promise<Entity | undefined> {
        const result = await this.getRoute(
            trackingNum,
            extraParams["phonenum"],
        );
        if (result === undefined) return undefined;

        return await this.convert(
            trackingNum,
            result,
            extraParams,
            updateMethod,
        );
    }

    /**
     * Generate a signed digest for API requests
     * @param {string} msgString - The request payload as a string
     * @param timestamp - the time
     * @param {string} checkWord - The application key
     * @returns {string} - The signed digest
     */
    private static generateSignature(
        msgString: string,
        timestamp: number,
        checkWord: string,
    ): string {
        // need to encode the input data
        return createHash("md5").update(
            encodeURIComponent(msgString + timestamp + checkWord),
        ).digest("base64");
    }

    /**
     * Retrieves shipment route details from the SF Express API.
     * @static
     * @async
     * @param {string} trackingNumber - The tracking number for the shipment.
     * @param {string} phoneNo - The phone number associated with the shipment.
     * @returns {Promise<Record<string, any>>} A promise that resolves to the raw API response data.
     * @throws {Error} If the API request fails or an error occurs during fetching.
     */
    static async getRoute(
        trackingNumber: string,
        phoneNo: string,
    ): Promise<Record<string, any>> {
        // live
        const SF_EXPRESS_API_URL = Deno.env.get("SF_EXPRESS_API_URL") ?? "";
        const SF_Express_PartnerID = Deno.env.get("SF_EXPRESS_PartnerID") ?? "";
        const SF_Express_CheckWord = Deno.env.get("SF_EXPRESS_CheckWord") ?? "";
        try {
            const msgData = {
                trackingType: 1,
                trackingNumber: trackingNumber,
                checkPhoneNo: phoneNo,
            };
            const timestamp = Date.now();
            const msgString = JSON.stringify(msgData);
            const msgDigest = Sfex.generateSignature(
                msgString,
                timestamp,
                SF_Express_CheckWord,
            );

            // Send the API request
            const response = await axios.post(SF_EXPRESS_API_URL, {
                partnerID: SF_Express_PartnerID,
                requestID: crypto.randomUUID(),
                serviceCode: "EXP_RECE_SEARCH_ROUTES",
                timestamp: timestamp,
                msgDigest: msgDigest,
                msgData: msgString,
            }, {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            });

            return response.data;
        } catch (error) {
            logger.error("Error fetching shipment details:", error);
            throw error;
        }
    }

    /**
     * Converts raw SF Express route data into a structured `Entity` object with events.
     * @private
     * @static
     * @async
     * @param {string} trackingNum - The tracking number of the shipment.
     * @param {Record<string, any>} result - The raw API response data.
     * @param {Record<string, string>} params - Additional parameters for the entity.
     * @param {string} updateMethod - The method used to update the tracking information.
     * @returns {Promise<Entity | undefined>} A promise that resolves to an `Entity` object or undefined if no routes are found.
     */
    private static async convert(
        trakingNum: string,
        result: Record<string, any>,
        params: Record<string, string>,
        updateMethod: string,
    ): Promise<Entity | undefined> {
        const apiResult = JSON.parse(result["apiResultData"]);
        const routeResp = apiResult["msgData"]["routeResps"][0];
        const routes: [] = routeResp["routes"];
        if (routes.length == 0) return undefined;

        const entity: Entity = new Entity();
        entity.uuid = "eg1_" + crypto.randomUUID();
        entity.id = trakingNum;
        entity.type = "waybill";
        entity.params = params;
        entity.extra = {};
        routes.sort((a, b) =>
            new Date(a["acceptTime"]).getTime() -
            new Date(b["acceptTime"]).getTime()
        );
        for (let i = 0; i < routes.length; i++) {
            const route = routes[i];

            const sfStatusCode = route["secondaryStatusCode"];
            const sfOpCode = route["opCode"];
            const status = Sfex.getEventCode(sfStatusCode, sfOpCode);
            const event: Event = new Event();

            const eventId = "ev_" + await jsonToMd5(route);
            if (entity.isEventIdExist(eventId)) continue;

            event.eventId = eventId;
            event.operatorCode = "sfex";
            event.trackingNum = routeResp["mailNo"];
            event.status = status;
            event.what = CodeDesc.getDesc(status);
            // acceptTime format: 2024-10-26 06:12:43
            const acceptTime: string = route["acceptTime"];
            // convert to isoStringWithTimezone : "2024-10-26T06:12:43+08:00"
            event.when = acceptTime.replace(" ", "T") + "+08:00";
            event.where = route["acceptAddress"];
            event.whom = "SFEx";
            event.notes = route["remark"];
            event.dataProvider = "SF Express";
            event.extra = {
                lastUpdateMethod: updateMethod,
                lastUpdateTime: new Date().toISOString(),
            };
            event.sourceData = route;
            entity.addEvent(event);
        }
        return entity;
    }

}
