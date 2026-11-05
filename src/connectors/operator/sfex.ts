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
import { v7 as uuidv7 } from "@std/uuid";
import { config } from "../../../config.ts";
import {whereIsAPI, logger} from "../../tools/logger.ts";
import {DataUpdateMethod, Entity, Event, StatusCode, TrackingID, AppError} from "../../main/model.ts";
import {getResponseJSON, adjustDateAndFormatWithTimezone, formatTimezoneOffset, httpPost} from "../../tools/util.ts";
import {OperatorModule} from "../../main/operator.ts";

/**
 * SF Express API client class for tracking shipments and managing route data.
 */
export class Sfex implements OperatorModule {

  // If the entity contains 3350 and the subsequent statuses include [3004,3450,3500],
  // then it is considered that 3400 is missing.
  private static readonly POST_3400_STATUSES: number[] = [3004, 3450, 3500] as const;

  // A departure that is still heading into a customs facility is not evidence of
  // clearance: "leaving the HK hub, on the way to the Guangzhou customs post" is
  // followed by customs clearance again at the destination. Export clearance in
  // the origin country also maps to 3350, so without this guard a 3400 would be
  // generated in the origin before the shipment has even arrived. The pattern
  // matches zh-CN remarks, which is what SF returns today (no language parameter
  // is sent).
  private static readonly HEADING_TO_CUSTOMS =
    /(?:发往|前往)[^，。,;；]*?(?:关务组|清关|报关|海关)/;

  // If the entity contains 3250 and the subsequent statuses include [3002, 3003, 3004, 3350, 3400, 3500],
  // then it is considered that 3300 is missing.
  private static readonly POST_3300_STATUSES: number[] = [3002, 3003, 3004, 3350, 3400, 3450, 3500] as const;

  // Separate customs territories the import shipments transit through. Their
  // clearance updates are not the arrival in the destination country. Matched
  // against the start of the location so street names ("香港中路") do not count.
  private static readonly TRANSIT_REGIONS: string[] = [
    "香港", "澳門", "澳门", "臺灣", "台湾", "台北", "臺北", "台中", "臺中", "桃园", "桃園", "高雄",
  ];

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
    "201": function (_entity: Entity, sourceData: Record<string, unknown>): number {
      const map: Record<string, number> = {
        "30": 3001,   // Logistics In-Progress
        "31": 3002,   // Arrived, In-Transit
        "36": 3004,   // Departed, In-Transit
        "105": 3250,  // In-Transit
        "106": 3300,  // Arrived At Destination
        "310": 3002,  // Arrived, In-Transit
      };
      const remark = sourceData["remark"] as string;
      if (/完成分拣/.test(remark)) {
        return 3003;  // Scanned, In-Transit
      } else if (/快件离开/.test(remark)) {
        return 3004;  // Departed, In-Transit
      } else {
        return map[sourceData["opCode"] as string] as number;
      }
    },
    "204": function (_entity: Entity, sourceData: Record<string, unknown>): number {
      const secondaryStatusName = sourceData["secondaryStatusName"] as string;
      if (/清关中/.test(secondaryStatusName)) {
        return 3350;  // Customs Clearance: Import In-Progress
      } else {
        return 3001;  // Logistics In-Progress
      }
    },
    "205": function (_entity: Entity, sourceData: Record<string, unknown>): number {
      const secondaryStatusName = sourceData["secondaryStatusName"] as string;
      if (/已清关/.test(secondaryStatusName)) {
        return 3400;  // Customs Clearance: Import Released
      } else {
        return 3001;  // Logistics In-Progress
      }
    },
    "301": function (_entity: Entity, sourceData: Record<string, unknown>): number {
      const secondaryStatusName = sourceData["secondaryStatusName"] as string;
      if (/派送中/.test(secondaryStatusName)) {
        return 3450;  // Final Delivery In-Progress
      }
      return 3001;    // Logistics In-Progress
    },
    "1301": function (entity: Entity, sourceData: Record<string, unknown>): number {
      // "待派送" is a domestic delivery stage (awaiting the courier), not the
      // arrival in the destination country. On a cross-border route the country
      // arrival is the arrival scan, so this stays an in-progress update.
      if (sourceData["opCode"] === "70" && !Sfex.isCrossBorderRoute(entity)) {
        return 3300;  // Arrived At Destination
      }
      return 3001;    // Logistics In-Progress
    },
    "401": {
      "80": 3500,     // Delivered
    },
  };

  // Define missing event configurations to check and supplement
  // Note: checkMethod and getBaseEventMethod must remain static
  // as they are referenced in this static configuration array
  private static readonly missingEventConfigs = [
    {
      status: 3300,
      notes: "Destination country. Supplement event generated by Eagle1",
      checkMethod: Sfex.isMissing3300,
      getBaseEventMethod: Sfex.get3300BaseEvent,
    },
    {
      status: 3400,
      notes: "Supplement event generated by Eagle1",
      checkMethod: Sfex.isMissing3400,
      getBaseEventMethod: Sfex.get3400BaseEvent,
    },
  ];

  /**
   * Generate a signed digest for API requests
   * @param {string} msgString - The request payload as a string
   * @param timestamp - the time
   * @param {string} checkWord - The application key
   * @returns {string} - The signed digest
   */
  private static async generateSignature(msgString: string, timestamp: number, checkWord: string): Promise<string> {
    // Encode the input data
    const encoder = new TextEncoder();
    const data = encoder.encode(encodeURIComponent(msgString + timestamp + checkWord));
    const hashBuffer = await crypto.subtle.digest("MD5", data);
    // Output base64 string
    const hashArray = new Uint8Array(hashBuffer);
    return btoa(String.fromCharCode(...hashArray));
  }

  /**
   * Validates the format of an SF Express tracking number.
   * A valid tracking number must start with "SF" followed by 13 digits.
   *
   * @param {string} trackingNum - The tracking number to validate.
   * @throws {AppError} Throws an error if the tracking number does not match the required format.
   */
  validateTrackingNum(trackingNum: string): void {
    if (!/^SF\d{13}$/.test(trackingNum)) {
      throw new AppError("400-02", "ERR-SFEX-E: SFEX_FORMAT");
    }
  }

  /**
   * Extracts SF Express-specific parameters from the request query parameters.
   * For SF Express, this is the recipient's or sender's phone number, which is required for tracking.
   *
   * @param {Record<string, string>} params - The query parameters from the HTTP request.
   * @returns {Record<string, string>} An object containing the `phonenum` parameter. If `phonenum` is not present in the input, it defaults to an empty string.
   */
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
      throw new AppError("400-03", "ERR-SFEX-C: PHONENUM");
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
      throw new AppError("400-03", "ERR-SFEX-D: PHONENUM");
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
  async pullFromSource(trackingIds: TrackingID[], extraParams: Record<string, string>, updateMethod: string): Promise<Entity[]> {
    if (trackingIds.length === 0) {
      return [];
    }

    const trackingId = trackingIds[0];
    const result = await this.getRoute(trackingId.trackingNum, extraParams["phonenum"]);

    const resultCode = result["apiResultCode"] as string;
    switch (resultCode) {
      case "A1000": {   // Success
        const entity = this.convert(trackingId, result, extraParams, updateMethod);
        return entity ? [entity] : [];
      }
      case "A1001":     // Invalid or missing data source API credentials
      case "A1004":
      case "A1006":
        throw new AppError("500-01", `ERR-SFEX-B: ${resultCode}`);
      default:
        // Handle other API errors
        throw new AppError("500-02", `ERR-SFEX-G: ${resultCode}: ${result["apiErrorMsg"]}`);
    }
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
    throw new AppError("404-02", "ERR-SFEX-A: SFEX");
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
    const DEFAULT_STATUS_CODE = 3001;
    const statusCode = sourceData["secondaryStatusCode"] as string;
    const opCode = sourceData["opCode"] as string;
    const statusMap = Sfex.statusCodeMap[statusCode];

    if (!statusMap) return DEFAULT_STATUS_CODE;

    if (typeof statusMap === "function") {
      const result = statusMap(entity, sourceData);
      return typeof result === "number" ? result : DEFAULT_STATUS_CODE;
    }

    const value = (statusMap as Record<string, unknown>)[opCode];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "function") {
      const result = value(entity, sourceData);
      return typeof result === "number" ? result : DEFAULT_STATUS_CODE;
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
    const msgData = {trackingType: 1, trackingNumber: [trackingNumber], checkPhoneNo: phoneNo};
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
      throw new AppError("500-02", `ERR-SFEX-F - getRoute(${response.status})`);
    }

    return await getResponseJSON(response, "ERR-SFEX-G - getRoute");
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
      const apiResultCode = String(result["apiResultCode"] ?? "unknown");
      logger.error(`${whereIsAPI("exception")} ${updateMethodName} -> SFEX: Unexpected data for ${trackingId.toString()} (empty routes[], apiResultCode=${apiResultCode}).`);
      return undefined;
    }

    const entity: Entity = new Entity();
    entity.uuid = uuidv7.generate();
    entity.id = trackingId.toString();
    entity.type = "waybill";
    entity.usePull = true;
    entity.params = params;
    entity.additional = {};

    for (const route of routes) {
      const event: Event = this.createEvent(trackingId, entity, route, updateMethod);

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
        if (!baseEvent || !baseEvent.when || !baseEvent.where) continue;

        const supplementEvent: Event = this.createSupplementEvent(
            trackingId,
            config.status,
            baseEvent.when as string,
            baseEvent.where as string,
            config.notes
        );
        entity.addEvent(supplementEvent);
        entity.sortEventsByWhen();
      }
    }

    return entity;
  }


  /**
   * Checks if a 3300 status event (Arrived At Destination) is missing from the entity's events.
   *
   * Three patterns are covered: the entry into the destination country, a 3250
   * in-transit event followed by later progress, and a shipment that is out for
   * delivery or already delivered without any arrival event.
   *
   * @param entity - The Entity object containing the events to be checked.
   * @returns `true` if the 3300 status event is considered missing, otherwise `false`.
   */
  static isMissing3300(entity: Entity): boolean {
    if (entity.events.some((event) => event.status === 3300)) {
      return false;
    }
    return Sfex.get3300BaseEvent(entity) !== undefined;
  }

  /**
   * Finds the base event for generating a supplementary 3300 status event (Arrived At Destination).
   *
   * The route is re-read every few minutes, so the rules only fire once the data
   * needed for the answer is actually there. On a cross-border route the base is
   * the first arrival scan after the international leg - while the shipment is
   * still in transit, nothing is generated. On a domestic route the older
   * in-transit heuristic still applies.
   *
   * @param entity - The Entity object containing the events to be searched.
   * @returns The Event object that can serve as the base for a 3300 status event, or undefined if no suitable event is found.
   */
  static get3300BaseEvent(entity: Entity): Event | undefined {
    if (Sfex.isCrossBorderRoute(entity)) {
      return Sfex.get3300BaseEventAtCountryEntry(entity);
    }
    return Sfex.get3300BaseEventInTransit(entity);
  }

  /**
   * Tells whether the route crosses a customs boundary: it has customs events,
   * or it has already passed a transit region. Until then the destination
   * country is unknown and no arrival may be inferred.
   */
  private static isCrossBorderRoute(entity: Entity): boolean {
    return entity.events.some((event) =>
      event.status === 3350 ||
      event.status === 3400 ||
      Sfex.isTransitRegion(event.where ?? "")
    );
  }

  /**
   * Finds the shipment's entry into the destination country (or region, for
   * mainland China): the first arrival scan after the international leg.
   *
   * The import customs start is the first 3350 outside a transit region. The
   * international leg ends at the last flight (3250) or transit-region event
   * before it, and the import segment ends when the shipment leaves the customs
   * post (3004). Only that segment is searched, so a domestic arrival days later
   * cannot stand in for the landing, and the anchor does not depend on the
   * customs city.
   *
   * SF sometimes logs the import release before that arrival scan. In that case
   * the scan is a late facility scan, so the earliest event after the leg is
   * used instead, and the 3300 stays before the 3400.
   */
  private static get3300BaseEventAtCountryEntry(entity: Entity): Event | undefined {
    let importCustoms = -1;
    for (const [i, event] of entity.events.entries()) {
      if ((event.status === 3350 || event.status === 3400) &&
        !Sfex.isTransitRegion(event.where ?? "")) {
        importCustoms = i;
        break;
      }
    }
    if (importCustoms < 0) {
      return undefined;
    }

    let legEnd = -1;
    for (let i = 0; i < importCustoms; i++) {
      const event = entity.events[i];
      if (event.status === 3250 || Sfex.isTransitRegion(event.where ?? "")) {
        legEnd = i;
      }
    }
    if (legEnd < 0) {
      // No flight and no transit event: the country segment cannot be located.
      return undefined;
    }

    let segmentEnd = entity.events.length;
    for (let i = importCustoms + 1; i < entity.events.length; i++) {
      if (entity.events[i].status === 3004) {
        segmentEnd = i;
        break;
      }
    }

    const releaseIndex = entity.events.findIndex((event, i) =>
      i > legEnd && event.status === 3400 && !Sfex.isTransitRegion(event.where ?? "")
    );
    const releaseTime = releaseIndex >= 0 && entity.events[releaseIndex].when
      ? new Date(entity.events[releaseIndex].when!).getTime()
      : Infinity;
    const timeOf = (event?: Event) =>
      event?.when ? new Date(event.when).getTime() : Infinity;
    const customsWhere = entity.events[importCustoms].where;

    let firstAfterLeg: Event | undefined;
    for (let i = legEnd + 1; i < segmentEnd; i++) {
      const event = entity.events[i];
      if (Sfex.isTransitRegion(event.where ?? "")) {
        continue;
      }
      firstAfterLeg ??= event;

      if (event.status !== 3002) {
        continue;
      }
      // Without a release yet, only an arrival at or before the customs post is
      // trusted: a domestic arrival could otherwise be taken for the landing.
      const settled = releaseIndex >= 0
        ? timeOf(event) < releaseTime
        : i < importCustoms || event.where === customsWhere;
      if (settled) {
        return event;
      }
    }

    // No usable scan yet. The fallback is only taken once the shipment is
    // delivered, so a scan that arrives later cannot move the anchor.
    if (!entity.events.some((event) => event.status === 3500)) {
      return undefined;
    }
    return firstAfterLeg && timeOf(firstAfterLeg) < releaseTime
      ? firstAfterLeg
      : undefined;
  }

  /**
   * Tells whether a location is a transit region rather than the destination.
   */
  private static isTransitRegion(where: string): boolean {
    return Sfex.TRANSIT_REGIONS.some((region) => where.startsWith(region));
  }

  /**
   * Finds the first event after an in-transit event (3250) that shows further
   * progression in the shipment process.
   */
  private static get3300BaseEventInTransit(entity: Entity): Event | undefined {
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
   * Checks whether an event's notes describe a departure that is still heading
   * into a customs facility (as opposed to leaving one).
   *
   * @param event - The event to inspect.
   * @returns `true` when the event is en route to customs, otherwise `false`.
   */
  static isHeadingToCustoms(event: Event): boolean {
    return Sfex.HEADING_TO_CUSTOMS.test(event.notes ?? "");
  }

  /**
   * Checks if a 3400 status event (Customs Clearance: Import Released) is missing from the entity's events.
   * This function is used to determine if a supplementary 3400 event needs to be added to the tracking history.
   *
   * @param entity - The Entity object containing the events to be checked.
   * @returns A boolean indicating whether a 3400 status event is missing (true) or not (false).
   */
  static isMissing3400(entity: Entity): boolean {
    return Sfex.get3400BaseEvent(entity) !== undefined;
  }

  /**
   * Finds the base event for generating a supplementary 3400 status event (Customs Clearance: Import Released).
   *
   * A 3400 reported for the last customs location, or after it, wins over
   * generating one, even when another 3350 follows it. A 3400 recorded only in
   * the origin does not suppress the destination supplement. The candidate is
   * searched from the last customs event: export clearance in the origin also
   * maps to 3350, and a departure from the origin hub is not evidence that import
   * clearance finished. A departure that is still heading into customs is skipped.
   *
   * Known limitation: a route whose only customs event so far is the origin
   * clearance, and whose departure remark does not mention customs (e.g. "发往
   * 【深圳】"), still yields an origin 3400. The scheduler re-pulls the shipment
   * and compare() drops that event once the destination customs event arrives,
   * so the error is transient. Detecting it earlier needs a signal the SF route
   * does not provide.
   *
   * @param entity - The Entity object containing the events to be searched.
   * @returns The Event object that can serve as the base for a 3400 status event, or undefined if no suitable event is found.
   */
  static get3400BaseEvent(entity: Entity): Event | undefined {
    let lastCustomsIndex = -1;

    for (let i = 0; i < entity.events.length; i++) {
      if (entity.events[i].status === 3350) {
        lastCustomsIndex = i;
      }
    }
    if (lastCustomsIndex < 0) {
      return undefined;
    }

    // A real 3400 for the last customs location, or after it, means SF reported
    // the clearance itself; a repeated 3350 must not make it look missing. A 3400
    // recorded in the origin (different location, before the destination customs
    // event) does not suppress the destination supplement.
    const lastCustomsEvent = entity.events[lastCustomsIndex];
    for (let i = 0; i < entity.events.length; i++) {
      const event = entity.events[i];
      if (event.status !== 3400) {
        continue;
      }
      const samePlace = event.where !== undefined &&
        event.where === lastCustomsEvent.where;
      if (samePlace || i > lastCustomsIndex) {
        return undefined;
      }
    }

    // Candidates are searched from the last customs event: a departure from the
    // origin hub before the destination customs event must not qualify.
    for (let i = lastCustomsIndex + 1; i < entity.events.length; i++) {
      const event = entity.events[i];
      if (
        Sfex.POST_3400_STATUSES.includes(event.status) &&
        !Sfex.isHeadingToCustoms(event)
      ) {
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
          `${whereIsAPI("data_monitor")} ${updateMethodName} -> SFEX: Future event detected for ${trackingId.toString()}. ` +
          `Event time: ${eventTime}, Current time(UTC): ${new Date().toISOString()}. Assigning status 3005 (Information Received).`
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
   * @param notes - The note that explains what the supplementary event represents.
   * @returns An Event object representing the supplementary tracking event.
   */
  private createSupplementEvent(trackingId: TrackingID, status: number, baseEventTime: string, where: string, notes: string): Event {
    const event: Event = new Event();
    const date = new Date(baseEventTime);
    const timeZone = config.sfex.dataSourceTimezone;
    const [secondsSinceEpoch, when] = adjustDateAndFormatWithTimezone(date, timeZone);

    event.eventId = `ev_${trackingId.toString()}-${secondsSinceEpoch}-${status}`;
    event.operatorCode = "sfex";
    event.trackingNum = trackingId.trackingNum;
    event.status = status;
    event.what = StatusCode.getDesc(status);
    // Format the date to "2024-10-26T06:12:43+08:00"
    event.when = when;
    event.where = where;
    event.whom = "SF Express";
    event.notes = notes;
    event.dataProvider = "Eagle1";
    event.additional = {
      updateMethod: "system-generated",
      updatedAt: new Date().toISOString(),
    };
    event.sourceData = {};

    return event;
  }

}