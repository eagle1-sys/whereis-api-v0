/**
 * @file sfex.ts
 * @description SF Express (Sfex) API client for tracking shipments and converting route data.
 * This module provides functionality to interact with the SF Express API, retrieve shipment routes,
 * and convert them into a structured object with associated `Event` details.
 */

import { Entity, Event, StatusCode, TrackingID } from "../main/model.ts";
import { crypto } from "@std/crypto";
import { config } from "../config.ts";
import { logger } from "../tools/logger.ts";

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
  private static statusCodeMap: Record<string, unknown> = {
    "101": {
      "50": 3100, // Received by Carrier
      "54": 3100, // Received by Carrier
    },
    "201": {
      "30": 3001, // Logistics In-Progress
      "31": 3002, // Arrived
      "36": 3004, // Departed
      "105": 3250, // In-Transit
      "106": 3300, // Arrived At Destination
      "310": 3002, // In-Transit
    },
    "204": function (
      _entity: Entity,
      sourceData: Record<string, unknown>,
    ): number {
      const secondaryStatusName = sourceData["secondaryStatusName"] as string;
      if (/清关中/.test(secondaryStatusName)) {
        return 3350; // Customs Clearance: Import In-Progress
      } else {
        return 3001; // Logistics In-Progress
      }
    },
    "205": function (
      _entity: Entity,
      sourceData: Record<string, unknown>,
    ): number {
      const secondaryStatusName = sourceData["secondaryStatusName"] as string;
      if (/已清关/.test(secondaryStatusName)) {
        return 3400; // Customs Clearance: Import Released
      } else {
        return 3001; // Logistics In-Progress
      }
    },
    "301": function (
      _entity: Entity,
      sourceData: Record<string, unknown>,
    ): number {
      const secondaryStatusName = sourceData["secondaryStatusName"] as string;
      if (/派送中/.test(secondaryStatusName)) {
        return 3450; // Final Delivery In-Progress
      }
      return 3001; // Logistics In-Progress
    },
    "1301": {
      "70": 3300, // Arrived At Destination
    },
    "401": {
      "80": 3500, // Delivered
    },
  };

  /**
   * Generate a signed digest for API requests
   * @param {string} msgString - The request payload as a string
   * @param timestamp - the time
   * @param {string} checkWord - The application key
   * @returns {string} - The signed digest
   */
  private static async generateSignature(
    msgString: string,
    timestamp: number,
    checkWord: string,
  ): Promise<string> {
    // Encode the input data
    const encoder = new TextEncoder();
    const data = encoder.encode(
      encodeURIComponent(msgString + timestamp + checkWord),
    );
    const hashBuffer = await crypto.subtle.digest("MD5", data);
    // Output base64 string
    const hashArray = new Uint8Array(hashBuffer);
    return btoa(String.fromCharCode(...hashArray));
  }

  /**
   * Queries the location and status of a shipment using its tracking number.
   * @static
   * @async
   * @param {TrackingID} trackingId - The tracking ID defined by eagle1.
   * @param {Record<string, string>} extraParams - Additional parameters, including phone number.
   * @param {string} updateMethod - The method used to update the tracking information.
   * @returns {Promise<Entity | undefined>} A promise that resolves to an object or undefined if no data is found.
   */
  static async whereIs(
    trackingId: TrackingID,
    extraParams: Record<string, string>,
    updateMethod: string,
  ): Promise<Entity[]> {
    const entities: Entity[] = [];
    const result = await this.getRoute(
      trackingId.trackingNum,
      extraParams["phonenum"],
    );

    const resultCode = result["apiResultCode"] as string;
    if (resultCode != "A1000") {
      throw new Error(resultCode);
    }

    const entity : Entity | undefined = this.convert(
      trackingId,
      result,
      extraParams,
      updateMethod,
    );

    if(entity!==undefined) {
      entities.push(entity);
    }

    return entities;
  }

  /**
   * Retrieves the internal event code based on SF Express status and operation codes.
   *
   * @static
   * @param {Entity} entity - The tracking entity.
   * @param {Record<string, unknown>} sourceData - Additional source data for complex mappings.
   * @returns {number} The corresponding internal event code. Returns 3001 if no specific mapping is found.
   */
  static getStatusCode(
    entity: Entity,
    sourceData: Record<string, unknown>,
  ): number {
    const statusCode = sourceData["secondaryStatusCode"] as string;
    const opCode = sourceData["opCode"] as string;
    const statusMap = Sfex.statusCodeMap[statusCode];
    if (!statusMap) return 3001;

    if (typeof statusMap === "function") {
      const result = statusMap(entity, sourceData);
      return typeof result === "number" ? result : 3001;
    }

    const value = (statusMap as Record<string, unknown>)[opCode];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "function") {
      const result = value(entity, sourceData);
      return typeof result === "number" ? result : 3001;
    }

    return 3001;
  }

  /**
   * Retrieves shipment route details from the SF Express API.
   * @static
   * @async
   * @param {string} trackingNumber - The tracking number for the shipment.
   * @param {string} phoneNo - The phone number associated with the shipment.
   * @returns {Promise<Record<string, unknown>>} A promise that resolves to the raw API response data.
   * @throws {Error} If the API request fails or an error occurs during fetching.
   */
  static async getRoute(
    trackingNumber: string,
    phoneNo: string,
  ): Promise<Record<string, unknown>> {
    // live
    const sfexApiUrl = config.sfex.apiUrl ?? "";
    const sfexPartnerId = Deno.env.get("SFEX_PARTNER_ID") ?? "";
    const sfexCheckWord = Deno.env.get("SFEX_CHECK_WORD") ?? "";
    const msgData = {
      trackingType: 1,
      trackingNumber: [trackingNumber],
      checkPhoneNo: phoneNo,
    };
    const timestamp = Date.now();
    const msgString = JSON.stringify(msgData);
    const msgDigest = await Sfex.generateSignature(
      msgString,
      timestamp,
      sfexCheckWord,
    );

    const response = await fetch(sfexApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(
        {
          partnerID: sfexPartnerId,
          requestID: crypto.randomUUID(),
          serviceCode: "EXP_RECE_SEARCH_ROUTES",
          timestamp: timestamp.toString(),
          msgDigest: msgDigest,
          msgData: msgString,
        },
      ),
    });
    return await response.json();
  }

  /**
   * Converts raw SF Express route data into a structured  object with events.
   * @param {TrackingID} trackingId - The tracking ID defined by eagle1.
   * @param {Record<string, unknown>} result - The raw API response data.
   * @param {Record<string, string>} params - Additional parameters for the object.
   * @param {string} updateMethod - The method used to update the tracking information.
   * @returns {Entity} An Entity object represents the shipment data.
   */
  private static convert(
    trackingId: TrackingID,
    result: Record<string, unknown>,
    params: Record<string, string>,
    updateMethod: string,
  ): Entity | undefined {
    const apiResult = JSON.parse(result["apiResultData"] as string);
    const routeResp = apiResult["msgData"]["routeResps"][0];
    const routes: [] = routeResp["routes"];
    if (routes.length == 0) {
      // convert the first character of a string to uppercase. eg: auto-pull -> Auto-pull
      const updateMethodName = updateMethod.charAt(0).toUpperCase() + updateMethod.slice(1);
      logger.warn(`${updateMethodName} -> SFEX: Unexpected data received for ${trackingId.toString()}. Empty routes[] in the received response: ${JSON.stringify(result)}`);
      return undefined;
    }

    const entity: Entity = new Entity();
    entity.uuid = "eg1_" + crypto.randomUUID();
    entity.id = trackingId.toString();
    entity.type = "waybill";
    entity.params = params;
    entity.extra = {};
    for (const route of routes) {
      const event = this.createEvent(trackingId, entity, route, updateMethod);
      if (event && !entity.isEventIdExist(event.eventId)) {
        entity.addEvent(event);
      }
    }

    return entity;
  }

  /**
   * Creates an Event object from SF Express route data.
   *
   * @param trackingId - The tracking ID object containing the tracking number.
   * @param entity - The tracking entity containing the shipment information.
   * @param route - The route information from SF Express API.
   * @param updateMethod - The method used to update the tracking information.
   * @returns An Event object containing detailed information about the shipment status.
   */
  private static createEvent(
    trackingId: TrackingID,
    entity: Entity,
    route: Record<string, unknown>,
    updateMethod: string,
  ): Event {
    const trackingNum = trackingId.trackingNum;

    const status = Sfex.getStatusCode(entity, route);

    const event: Event = new Event();
    // acceptTime format: 2024-10-26 06:12:43
    const acceptTime: string = route["acceptTime"] as string;
    // convert to isoStringWithTimezone : "2024-10-26T06:12:43+08:00"
    const eventTime: string = acceptTime.replace(" ", "T") + "+08:00";
    const date = new Date(eventTime);
    const secondsSinceEpoch = Math.floor(date.getTime() / 1000);
    event.eventId =
      `ev_${trackingId.toString()}-${secondsSinceEpoch}-${status}`;
    event.operatorCode = "sfex";
    event.trackingNum = trackingNum;
    event.status = status;
    event.what = StatusCode.getDesc(status);
    event.when = eventTime;
    const remark: string = (route["remark"] as string).trim();
    if (remark.startsWith("快件途经")) {
      event.where = remark.substring(4);
    } else {
      event.where = route["acceptAddress"] as string;
    }
    event.whom = "SF Express";
    event.notes = remark.toLowerCase() === event.what.toLowerCase()
      ? ""
      : remark;
    event.dataProvider = "SF Express";
    event.extra = {
      updateMethod: updateMethod,
      updatedAt: new Date().toISOString(),
    };
    event.sourceData = route;

    return event;
  }
}
