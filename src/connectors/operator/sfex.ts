/**
 * @file sfex.ts
 * @description SF Express (Sfex) API client for tracking shipments and converting route data.
 * This module provides functionality to interact with the SF Express API, retrieve shipment routes,
 * and convert them into a structured object with associated `Event` details.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { crypto } from "@std/crypto";
import { config } from "../../../config.ts";
import { logger } from "../../tools/logger.ts";
import {isOperatorActive} from "../../main/gateway.ts";
import {DataUpdateMethod, Entity, Event, StatusCode, TrackingID, AppError} from "../../main/model.ts";
import {getResponseJSON, adjustDateAndFormatWithTimezone, formatTimezoneOffset, httpPost} from "../../tools/util.ts";
import {OperatorModule} from "../../main/operator.ts";

/**
 * SF Express API client class for tracking shipments and managing route data.
 */
export class Sfex implements OperatorModule{

  // Post statuses for the event '3400: Customs Clearance: Import Released'
  private static readonly POST_3400_STATUSES: number[] = [3004, 3450, 3500] as const;
  // Post statuses for the event '3300: Arrived at Destination'
  private static readonly POST_3300_STATUSES: number[] = [3002, 3003, 3004, 3350, 3400, 3500] as const;

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
    "201": function (
      _entity: Entity,
      sourceData: Record<string, unknown>,
    ): number {
      const map: Record<string, number> = {
        "30": 3001, // Logistics In-Progress
        "31": 3002, // Arrived, In-Transit
        "36": 3004, // Departed, In-Transit
        "105": 3250, // In-Transit
        "106": 3300, // Arrived At Destination
        "310": 3002, // Arrived, In-Transit
      };
      const remark = sourceData["remark"] as string;
      if (/完成分拣/.test(remark)) {
        return 3003; // Scanned, In-Transit
      } else if (/快件离开/.test(remark)) {
        return 3004; // Departed, In-Transit
      } else {
        return map[sourceData["opCode"] as string] as number;
      }
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

  // Define missing event configurations to check and supplement
  private static readonly missingEventConfigs = [
    {
      status: 3300,
      checkMethod: Sfex.isMissing3300.bind(this),
      getBaseEventMethod: Sfex.get3300BaseEvent.bind(this),
    },
    {
      status: 3400,
      checkMethod: Sfex.isMissing3400.bind(this),
      getBaseEventMethod: Sfex.get3400BaseEvent.bind(this),
    },
  ];

  /**
   * Generate a signed digest for API requests
   * @param {string} msgString - The request payload as a string
   * @param timestamp - the time
   * @param {string} checkWord - The application key
   * @returns {string} - The signed digest
   */
  private static async generateSignature(msgString: string, timestamp: number, checkWord: string,): Promise<string> {
    // Encode the input data
    const encoder = new TextEncoder();
    const data = encoder.encode(        encodeURIComponent(msgString + timestamp + checkWord));
    const hashBuffer = await crypto.subtle.digest("MD5", data);
    // Output base64 string
    const hashArray = new Uint8Array(hashBuffer);
    return btoa(String.fromCharCode(...hashArray));
  }

  validateTrackingNum(trackingNum: string): void {
    if (!/^SF\d{13}$/.test(trackingNum)) {
      throw new AppError("400-02", "400BE: model - SFEX_FORMAT");
    }
  }

  getExtraParams(params: Record<string, string>): Record<string, string> {
    return {phonenum: params.phonenum ?? ""};
  }

  /**
   * Validates parameters for SF Express tracking requests
   * @param _trackingId - The tracking ID being validated
   * @param params - Query parameters to validate
   * @throws AppError if validation fails
   */
  validateParams(_trackingId: TrackingID, params: Record<string, string>): boolean {
    // Validate phone number is present and not empty
    const phoneNum = params["phonenum"];
    if (phoneNum === undefined || phoneNum === "") {
      throw new AppError("400-03", "400AF: sfex - PHONENUM");
    }
    return true;
  }

  /**
   * Validates stored entity parameters match request parameters
   * @param entity - The stored entity
   * @param params - The request parameters
   * @throws AppError if validation fails
   */
  validateStoredEntity(entity: Entity, params: Record<string, string>): boolean {
    if (entity.params?.phonenum !== params.phonenum) {
      throw new AppError("400-03", "400AD: sfex - PHONENUM");
    }
    return true;
  }

  /**
   * Queries the location and status of a shipment using its tracking number.
   * @static
   * @async
   * @param {TrackingID} trackingIds - The tracking ID(s) defined by eagle1.
   * @param {Record<string, string>} extraParams - Additional parameters, including phone number.
   * @param {string} updateMethod - The method used to update the tracking information.
   * @returns {Promise<Entity | undefined>} A promise that resolves to an object or undefined if no data is found.
   */
  async pullFromSource(trackingIds: TrackingID[], extraParams: Record<string, string>, updateMethod: string,): Promise<Entity[]> {
    if (!isOperatorActive("sfex")) {
      throw new AppError("500-01", "500BA: sfex - PARTNERID");
    }

    const entities: Entity[] = [];
    const trackingId = trackingIds[0];
    const result = await this.getRoute(
        trackingId.trackingNum,
        extraParams["phonenum"],
    );

    const resultCode = result["apiResultCode"] as string;
    if (resultCode !== "A1000") {
      if (resultCode === "A1001" || resultCode === "A1004" || resultCode === "A1006") {
        // Invalid or missing data source API credentials
        throw new AppError("500-01", "500BB: sfex - PARTNERID");
      }
      throw new Error(`${resultCode}: ${result["apiErrorMsg"]}`);
    }

    const entity: Entity | undefined = this.convert(
        trackingId,
        result,
        extraParams,
        updateMethod,
    );

    if (entity !== undefined) {
      entities.push(entity);
    }

    return entities;
  }

  /**
   *
   * @remarks
   * SF Express operates as a pull-based data provider and does not support push operator.
   * This method is not implemented and will throw an error if called.
   *
   * @param _data - The JSON data object from operator containing event information to be converted.
   *                This parameter is prefixed with underscore as it is intentionally unused.
   *
   * @returns An array of Entity objects created from the JSON data.
   *
   * @throws {Error} Always throws an error indicating that SF Express does not support push operations.
   */
  processPushData(_data: Record<string, unknown>): Entity[] {
    throw new Error("SF Express is a pull-based operator and does not support push operation.");
  }

  /**
   * Retrieves the internal event code based on SF Express status and operation codes.
   *
   * @static
   * @param {Entity} entity - The tracking entity.
   * @param {Record<string, unknown>} sourceData - Additional source data for complex mappings.
   * @returns {number} The corresponding internal event code. Returns 3001 if no specific mapping is found.
   */
  static getStatusCode(entity: Entity, sourceData: Record<string, unknown>): number {
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
  async getRoute(trackingNumber: string, phoneNo: string,): Promise<Record<string, unknown>> {
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
    const msgDigest = await Sfex.generateSignature(msgString, timestamp, sfexCheckWord);

    const response = await httpPost(
        sfexApiUrl,
        {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        new URLSearchParams(
            {
              partnerID: sfexPartnerId,
              requestID: crypto.randomUUID(),
              serviceCode: "EXP_RECE_SEARCH_ROUTES",
              timestamp: timestamp.toString(),
              msgDigest: msgDigest,
              msgData: msgString,
            },
        )
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} [500BC - getRoute]`);
    }

    return await getResponseJSON(response, "500BC - getRoute")
  }

  /**
   * Converts raw SF Express route data into a structured  object with events.
   * @param {TrackingID} trackingId - The tracking ID defined by eagle1.
   * @param {Record<string, unknown>} result - The raw API response data.
   * @param {Record<string, string>} params - Additional parameters for the object.
   * @param {string} updateMethod - The method used to update the tracking information.
   * @returns {Entity} An Entity object represents the shipment data.
   */
  private convert(trackingId: TrackingID, result: Record<string, unknown>, params: Record<string, string>, updateMethod: string): Entity | undefined {
    const apiResult = JSON.parse(result["apiResultData"] as string);
    const routeResp = apiResult["msgData"]["routeResps"][0];
    const routes: [] = routeResp["routes"];
    if (routes.length == 0) {
      // get the display text of the data retrieval method. eg: auto-pull -> Auto-pull
      const updateMethodName = DataUpdateMethod.getDisplayText(updateMethod);
      logger.warn(
        `${updateMethodName} -> SFEX: Unexpected data received for ${trackingId.toString()}. Empty routes[] in the received response: ${
          JSON.stringify(result)
        }`,
      );
      return undefined;
    }

    const entity: Entity = new Entity();
    entity.uuid = "eg1_" + crypto.randomUUID();
    entity.id = trackingId.toString();
    entity.type = "waybill";
    entity.params = params;
    entity.additional = {};

    for (const route of routes) {
      const event: Event = this.createEvent(
        trackingId,
        entity,
        route,
        updateMethod,
      );

      // Add the event to the entity
      if (!entity.isEventIdExist(event.eventId)) {
        entity.addEvent(event);
      }
    }

    // sort the events based on when
    entity.sortEventsByWhen();

    // Process each missing event configuration
    for (const config of Sfex.missingEventConfigs) {
      if (config.checkMethod(entity)) {
        const baseEvent = config.getBaseEventMethod(entity);
        if (baseEvent && baseEvent.when && baseEvent.where) {
          const supplementEvent: Event = this.createSupplementEvent(
              trackingId,
              config.status,
              baseEvent.when as string,
              baseEvent.where as string,
          );
          entity.addEvent(supplementEvent);
          entity.sortEventsByWhen();
        }
      }
    }

    return entity;
  }


  static isMissing3300(entity: Entity): boolean {
    let isTransitToDestEventOccurred: boolean = false;

    for (const event of entity.events) {
      if (event.status === 3250) {
        isTransitToDestEventOccurred = true;
      }

      // If a 3300 status event already exists in the entity
      if (event.status === 3300) {
        return false;
      }

      if (isTransitToDestEventOccurred && Sfex.POST_3300_STATUSES.includes(event.status)) {
        return true;
      }
    }
    return false;
  }

  static get3300BaseEvent(entity: Entity): Event | undefined {
    let isTransitToDestEventOccurred: boolean = false;

    for (const event of entity.events) {
      if (event.status === 3250) {
        isTransitToDestEventOccurred = true;
      }

      if (isTransitToDestEventOccurred && Sfex.POST_3300_STATUSES.includes(event.status)) {
        return event;
      }
    }

    return undefined;
  }

  /**
   * Checks if a 3400 status event (Customs Clearance: Import Released) is missing from the entity's events.
   * This function is used to determine if a supplementary 3400 event needs to be added to the tracking history.
   *
   * @param entity - The Entity object containing the events to be checked.
   * @returns A boolean indicating whether a 3400 status event is missing (true) or not (false).
   */
  static isMissing3400(entity: Entity): boolean {
    let isCustomsEventOccurred: boolean = false;

    for (const event of entity.events) {
      if (event.status === 3350) {
        isCustomsEventOccurred = true;
      }

      // If a 3400 status event already exists in the entity
      if (event.status === 3400) {
        return false;
      }

      if (isCustomsEventOccurred && Sfex.POST_3400_STATUSES.includes(event.status)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Finds the base event for generating a supplementary 3400 status event (Customs Clearance: Import Released).
   * This function searches for the first event that occurs after a customs event (3350) and has a status
   * indicating further progression in the shipment process.
   *
   * @param entity - The Entity object containing the events to be searched.
   * @returns The Event object that can serve as the base for a 3400 status event, or undefined if no suitable event is found.
   */
  static get3400BaseEvent(entity: Entity): Event | undefined {
    let isCustomsEventOccurred: boolean = false;

    for (const event of entity.events) {
      if (event.status === 3350) {
        isCustomsEventOccurred = true;
      }

      if (isCustomsEventOccurred && Sfex.POST_3400_STATUSES.includes(event.status)) {
        return event;
      }
    }

    return undefined;
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
  private createEvent(trackingId: TrackingID, entity: Entity, route: Record<string, unknown>, updateMethod: string): Event {
    const trackingNum: string = trackingId.trackingNum;
    // Get the original status before future event check
    let status: number = Sfex.getStatusCode(entity, route);

    const event: Event = new Event();
    const timeZone = config.sfex.dataSourceTimezone;
    // acceptTime format: 2024-10-26 06:12:43
    const acceptTime: string = route["acceptTime"] as string;
    // eg: convert to isoStringWithTimezone : "2024-10-26T06:12:43+08:00"
    const eventTime: string = acceptTime.replace(" ", "T") + formatTimezoneOffset(timeZone);
    const date = new Date(eventTime);

    // Check if this is a future event
    const eventTimestamp = date.getTime();
    const currentTimestamp = Date.now();

    if (eventTimestamp > currentTimestamp) {
      // Override status for future events
      status = 3005; // "Information Received"
      // Log the future event detection for monitoring
      const updateMethodName = DataUpdateMethod.getDisplayText(updateMethod);
      logger.info(
          `${updateMethodName} -> SFEX: Future event detected for ${trackingId.toString()}. ` +
          `Event time: ${eventTime}, Current time(UTC): ${new Date().toISOString()}. ` +
          `Assigning status 3005 (Information Received).`
      );
    }

    const secondsSinceEpoch = Math.floor(date.getTime() / 1000);
    event.eventId = `ev_${trackingId.toString()}-${secondsSinceEpoch}-${status}`;
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
    event.notes = remark.toLowerCase() === event.what.toLowerCase() ? "" : remark;
    event.dataProvider = "SF Express";
    event.additional = {
      updateMethod: updateMethod,
      updatedAt: new Date().toISOString(),
    };
    event.sourceData = route;

    return event;
  }

  /**
   * Creates a supplementary event for tracking purposes.
   * This function is used to generate additional events that may be missing in the original data,
   * particularly for customs clearance scenarios.
   *
   * @param trackingId - The tracking ID object containing the tracking number and other identifiers.
   * @param status - The status code for the supplementary event.
   * @param baseEventTime - The date of the reference event in ISO 8601 format(2024-10-26T06:12:43+08:00).
   * @param where - The location information for the supplementary event.
   * @returns An Event object representing the supplementary tracking event.
   */
  private createSupplementEvent(trackingId: TrackingID, status: number, baseEventTime: string, where: string): Event {
    const event: Event = new Event();
    const date = new Date(baseEventTime);
    const timeZone = config.sfex.dataSourceTimezone;
    const [secondsSinceEpoch, when] = adjustDateAndFormatWithTimezone(date, timeZone);

    event.eventId =
        `ev_${trackingId.toString()}-${secondsSinceEpoch}-${status}`;
    event.operatorCode = "sfex";
    event.trackingNum = trackingId.trackingNum;
    event.status = status;
    event.what = StatusCode.getDesc(status);
    // Format the date to "2024-10-26T06:12:43+08:00"
    event.when = when;
    event.where = where;
    event.whom = "SF Express";
    event.notes = "Supplement event generated by Eagle1";
    event.dataProvider = "Eagle1";
    event.additional = {
      updateMethod: "system-generated",
      updatedAt: new Date().toISOString(),
    };
    event.sourceData = {};

    return event;
  }

}
