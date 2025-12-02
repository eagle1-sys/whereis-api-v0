/**
 * @file fdx.ts
 * @description A TypeScript class implementation for interacting with the FedEx tracking API.
 *              Provides functionality to authenticate with the API, fetch shipment tracking details,
 *              and convert FedEx tracking data into an internal format with associated events.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import {AppError, DataUpdateMethod, Entity, Event, ExceptionCode, StatusCode, TrackingID,} from "../../main/model.ts";
import {config} from "../../../config.ts";
import {logger} from "../../tools/logger.ts";
import {getResponseJSON} from "../../tools/util.ts";
import {isOperatorActive} from "../../main/gateway.ts";
import {adjustDateAndFormatWithTimezone, extractTimezone} from "../../tools/util.ts";

/**
 * A class to interact with the FedEx tracking API and manage shipment tracking information.
 */
export class Fdx {
  /** @type {string} The current authentication token for FedEx API requests. */
  private static token: string;
  /** @type {number} The expiration time of the token in milliseconds since epoch. Initially 0. */
  private static expireTime: number = 0;
  private static tokenPromise: Promise<string> | null = null;

  /**
   * A mapping of FedEx status codes and event types to internal event codes or functions.
   * @type {Record<string, Record<string, unknown>>}
   */
  private static statusCodeMap: Record<string, Record<string, unknown>> = {
    IN: {
      OC: 3000, // Transport Bill Created
    },
    IT: {
      DR: 3250, // In-Transit
      DP: function (
          _entity: Entity,
          sourceData: Record<string, unknown>,
      ): number {
        const locationType = sourceData.locationType as string;
        const eventDescription = sourceData.eventDescription as string;

        if (locationType === "ORIGIN_FEDEX_FACILITY") {
          return 3100; // Received by Carrier
        }

        if (/Departed FedEx hub/i.test(eventDescription)) {
          return 3250; // In-Transit
        }

        return 3004; // Departed, In-Transit
      },
      AR: function (
          _entity: Entity,
          sourceData: Record<string, unknown>,
      ): number {
        const locationType = sourceData["locationType"] as string;
        const eventDescription = sourceData["eventDescription"] as string;
        if (
            locationType === "SORT_FACILITY" &&
            /destination/i.test(eventDescription)
        ) {
          return 3300; // At destination sort facility
        }

        const locationTypeMap: { [key: string]: number } = {
          "ORIGIN_FEDEX_FACILITY": 3100, // Received by Carrier (just in case)
          "DESTINATION_FEDEX_FACILITY": 3300, // At local FedEx facility
        };
        return locationTypeMap[locationType] ?? 3002; // Arrived, In-Transit (default)
      },
      IT: function (
          _entity: Entity,
          sourceData: Record<string, unknown>,
      ): number {
        const exceptionCode = sourceData["exceptionCode"];
        if (exceptionCode == "67") {
          return 3450; // Final Delivery In-Progress
        } else {
          return 3001; // Logistics In-Progress
        }
      },
      AF: 3001, // Logistics In-Progress
      CC: function (
          _entity: Entity,
          sourceData: Record<string, unknown>,
      ): number | undefined {
        const desc = sourceData["eventDescription"] as string;
        if (/Export/i.test(desc)) {
          return 3200; // Customs Clearance: Export Released
        } else if (/Import/i.test(desc)) {
          return 3400; // Customs Clearance: Import Released
        }
      },
      OD: 3450, // Final Delivery In-Progress
      RR: 3450, // Delivery option requested
    },
    CD: {
      CD: function (
          _entity: Entity,
          sourceData: Record<string, unknown>,
      ): number | undefined {
        const desc = sourceData["eventDescription"] as string;
        if (/Import/i.test(desc)) {
          return 3350; // Customs Clearance: Import In-Progress
        } else {
          return 3150; // Customs Clearance: Export In-Progress
        }
      },
    },
    PU: {
      PU: 3050, // Picked up
    },
    DL: {
      DL: 3500, // Delivered
    },
    DE: {
      DE: 3450, // Final Delivery In-Progress
    },
    CA: {
      CA: 3009, // Process Stopped
    },
  };

  private static exceptionCodeMap: Record<string, number> = {
    "08": 907, // Recipient, Not Available
    "29": 909, // Rerouted
  };

  // Define missing event configurations to check and supplement
  private static readonly missingEventConfigs = [
    {
      status: 3100,
      checkMethod: this.isMissing3100.bind(this),
      getBaseEventMethod: this.get3100BaseEvent.bind(this),
    }
  ];

  /**
   * Fetches and manages the FedEx API authentication token.
   * This method implements a caching mechanism to reuse valid tokens and prevent multiple
   * simultaneous token requests.
   *
   * @returns {Promise<string>} A promise that resolves to the current or newly fetched authentication token.
   * @throws {Error} If the token cannot be retrieved from the FedEx API.
   */
  static async getToken(): Promise<string> {
    // If a token fetch is already in progress, return that promise
    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    // If the token is still valid, return it immediately
    if (Date.now() <= this.expireTime - 30000 && this.token) {
      return this.token;
    }

    // Start a new token fetch
    this.tokenPromise = this.fetchNewToken();

    try {
      // Wait for the token fetch to complete
      return await this.tokenPromise;
    } finally {
      // Clear the promise so future calls will start a new fetch if needed
      this.tokenPromise = null;
    }
  }

  /**
   * Fetches a new authentication token from the FedEx API.
   *
   * This function sends a POST request to the FedEx API to obtain a new access token.
   * It uses the client credentials (ID and secret) to authenticate the request.
   * If successful, it updates the class's token and expiration time.
   *
   * @throws {Error} If the API response doesn't contain an access token or has an invalid expiration time.
   * @throws {AppError} If the API returns specific error codes related to authentication.
   * @throws {Error} For any other unexpected API error responses.
   *
   * @returns {Promise<string>} A promise that resolves to the newly obtained access token.
   */
  static async fetchNewToken(): Promise<string> {
    const fdxApiUrl: string = config.fdx.apiUrl ?? "";
    const fdxClientId = Deno.env.get("FDX_CLIENT_ID");
    const fdxClientSecret = Deno.env.get("FDX_CLIENT_SECRET");
    if (!fdxClientId || !fdxClientSecret) {
      throw new AppError("500-01", "500AA: fdx - CLIENT_ID/SECRET");
    }

    const response = await fetch(fdxApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: fdxClientId,
        client_secret: fdxClientSecret,
      }),
    });

    const data: Record<string, unknown>  = await getResponseJSON(response, "500AC - getToken");

    // if successful, update the token and expiration time.
    if (response.ok) {
      if(!data["access_token"]) {
        throw new Error("SNH: No access_token provided in response [500AF - getToken]");
      }

      if (typeof data["expires_in"] !== "number" || data["expires_in"] <= 0) {
        throw new Error("SNH: Invalid or missing expires_in value [500AG - getToken]");
      }

      this.token = data["access_token"] as string;
      this.expireTime = Date.now() + (data["expires_in"] as number) * 1000;
      return this.token;
    } else {
      if(!data["errors"]) {
        throw new Error("SNH: No errors provided in response [500AF - getToken]");
      }

      if(!Array.isArray(data["errors"])){
        throw new Error("SNH: 'errors' field must be an array [500AH - getToken]");
      }

      const errors = data["errors"] as Array<{ code?: string; message?: string }>;
      // Just handle the first error code
      const code = errors[0]?.code ?? "";
      if(code==="BAD.REQUEST.ERROR" || code==="NOT.AUTHORIZED.ERROR") {
        // Invalid or missing data source API credentials
        throw new AppError("500-01", `500AA: fdx - ${code}`);
      } else {
        throw new Error(`Unexpected error code from FedEx API: ${code} [500AE - getToken]`);
      }
    }
  }

  /**
   * Retrieves the current location and tracking details for a given tracking number.
   * @param {TrackingID} trackingIds - The tracking ID(s) defined by eagle1.
   * @param _extraParams
   * @param {string} updateMethod - The method used to update the tracking information.
   * @returns {Promise<Entity | undefined>} A promise resolving to the tracking entity or undefined if not found.
   */
  static async whereIs(
      trackingIds: TrackingID[],
      _extraParams: Record<string, string>,
      updateMethod: string,
  ): Promise<Entity[]> {
    if(!isOperatorActive("fdx")) {
      throw new AppError("500-01", "500AB: fdx - CLIENT_ID");
    }

    const entities: Entity[] = [];
    const trackingNums: string[] = trackingIds.map((item) => item.trackingNum);
    const result: Record<string, unknown> = await this.getRoute(trackingNums);
    const output = result["output"] as Record<string, unknown>;
    if (output === undefined) {
      const trackingIdsStr: string = trackingIds.map((item) => item.toString())
          .join(", ");
      // get the display text of the data retrieval method. eg: auto-pull -> Auto-pull
      const updateMethodName = DataUpdateMethod.getDisplayText(updateMethod);
      logger.warn(
          `${updateMethodName} -> FDX: Unexpected data received for ${trackingIdsStr}. Missing output{} in the received response: ${
              JSON.stringify(result)
          }`,
      );
      return entities;
    }

    const completeTrackResults = output["completeTrackResults"] as Record<
        string,
        unknown
    >[];
    completeTrackResults.forEach(
        (completeTrackResult: Record<string, unknown>) => {
          const trackingId: TrackingID = TrackingID.parse(
              "fdx-" + completeTrackResult["trackingNumber"] as string,
          );
          const entity: Entity | undefined = Fdx.convert(
              trackingId,
              completeTrackResult,
              updateMethod,
          );
          if (entity !== undefined) {
            entities.push(entity);
          }
        },
    );

    return entities;
  }

  /**
   * Retrieves the internal event code based on FedEx status code, event type, and source data.
   * @param {Entity} entity - The entity from FedEx.
   * @param {Record<string, unknown>} sourceData - The raw event data from FedEx.
   * @returns {number} The corresponding internal event code, or 3001 if not found.
   */
  static getStatusCode(
      entity: Entity,
      sourceData: Record<string, unknown>,
  ): number {
    const derivedStatusCode = sourceData["derivedStatusCode"] as string;
    const eventType = sourceData["eventType"] as string;
    const statusMap = Fdx.statusCodeMap[derivedStatusCode];
    if (!statusMap) return 3001;

    const value = statusMap[eventType];

    if (typeof value === "number") return value;

    if (typeof value === "function") {
      const result = value(entity, sourceData);
      return typeof result === "number" ? result : 3001;
    }

    return 3001;
  }

  static getExceptionCode(
      sourceData: Record<string, unknown>,
  ): number | undefined {
    const code_original = sourceData["exceptionCode"] as string;
    if (!code_original || code_original === "71") {
      return undefined;
    }

    return Fdx.exceptionCodeMap[code_original] ?? 900;
  }

  /**
   * Constructs a location string from a scan location object.
   * @param {Record<string, unknown>} scanEvent - The scan location data.
   * @returns {string} A formatted string representing the location (e.g., "City State Country").
   */
  static getWhere(scanEvent: Record<string, unknown>): string {
    const scanLocation = scanEvent["scanLocation"] as Record<string, unknown>;
    const where = (scanLocation["city"] ?? "") + " " +
        (scanLocation["stateOrProvinceCode"] ?? "") + " " +
        (scanLocation["countryName"] ?? "");

    return where.trim() ||
        (scanEvent["locationType"] === "CUSTOMER" ? "Customer location" : "");
  }

  /**
   * Constructs an address string from an address object.
   * @param {Record<string, unknown>} address - The address data.
   * @returns {string} A formatted string representing the address (e.g., "City State Country").
   */
  static getAddress(address: Record<string, unknown>): string {
    return ((address["city"] as string ?? "") + " " +
        (address["stateOrProvinceCode"] as string ?? "") + " " +
        (address["countryName"] as string ?? "")).trim();
  }

  /**
   * Checks if a 3100 status event is missing from the entity's event sequence.
   *
   * This function iterates through the entity's events to determine if a 3100 status
   * event (typically representing "Received by Carrier") is missing where it should
   * be present in the logical sequence of events.
   *
   * @param {Entity} entity - The entity object containing an array of events to check.
   * @returns {boolean} Returns true if a 3100 status event is missing in the expected
   *                    sequence, false otherwise.
   */
  static isMissing3100(entity: Entity): boolean {
    for (const event of entity.events) {
      // if a 3100 event is found
      if (event.status === 3100) return false;

      // if an event with status greater than 3100 is found
      if (event.status > 3100) {
        return true;
      }
    }
    return false;
  }

  /**
   * Retrieves the base event for status code 3100 from the entity's events.
   * Scans chronologically, skipping pre‑milestones (<=3050 and multiples of 50) and stopping at the next milestone (>3100 and multiple of 50).
   * Returns the earliest event with status in [3001..3004] (inclusive) to serve as the base for creating a 3100 event.
   * @param {Entity} entity - The entity containing the events to search through.
   * @returns {Event | undefined} The earliest event with status 3001–3004 if found, otherwise undefined.
   *                              This event is used as a base for creating a 3100 status event.
   */
  static get3100BaseEvent(entity: Entity): Event | undefined {
    for (const event of entity.events) {
      // if the event status is less than 3100, skip it
      if (event.status < 3100) {
        continue;
      }

      // find the immediately following event
      if ((event.status >= 3001 && event.status <= 3004) || event.status > 3100) {
        return event;
      }
    }
    return undefined;
  }

  /**
   * Fetches the shipment route details for a given tracking number from the FedEx API.
   * @param {string} trackingNumbers - The FedEx tracking number(s).
   * @returns {Promise<Record<string, unknown>>} A promise resolving to the raw API response data.
   * @throws {Error} If the API request fails.
   */
  static async getRoute(
      trackingNumbers: string[],
  ): Promise<Record<string, unknown>> {
    // Prepare the request payload
    const trackingInfo: { trackingNumberInfo: { trackingNumber: string } }[] =
        [];
    trackingNumbers.forEach((trackingNum) =>
        trackingInfo.push({
          "trackingNumberInfo": {
            "trackingNumber": trackingNum,
          },
        })
    );

    const payload = {
      "includeDetailedScans": true,
      "trackingInfo": trackingInfo,
    };

    // Send the API request
    const token = await this.getToken();
    const fdxTrackApiUrl: string = config.fdx.trackApiUrl ?? "";
    const response = await fetch(fdxTrackApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-locale": "en_US",
        "Authorization": "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} [500AD - getRoute]`);
    }

    return await getResponseJSON(response, "500AD - getRoute");
  }

  /**
   * Converts raw FedEx API data into an internal object with events.
   * @param {TrackingID} trackingId - The tracking ID defined by eagle1.
   * @param {Record<string, unknown>} completeTrackResult - The raw API response data.
   * @param {string} updateMethod - The method used to update the tracking information.
   * @returns {Entity} An Entity object represents the trackingId's status.
   * @private
   */
  private static convert(
      trackingId: TrackingID,
      completeTrackResult: Record<string, unknown>,
      updateMethod: string,
  ): Entity | undefined {
    const entity: Entity = new Entity();
    const trackResults = completeTrackResult["trackResults"] as [unknown];
    const trackResult = trackResults[0] as Record<string, unknown>;

    if (trackResult["error"] !== undefined) {
      logger.error(
          `Error occurs during process ${trackingId.toString()}:` +
          JSON.stringify(trackResult["error"]),
      );
      return undefined;
    }

    entity.uuid = "eg1_" + crypto.randomUUID();
    entity.id = trackingId.toString();
    entity.params = {};
    entity.type = "waybill";
    entity.extra = {
      origin: Fdx.getAddress(
          (trackResult["shipperInformation"] as Record<string, unknown>)[
              "address"
              ] as Record<string, unknown>,
      ),
      destination: Fdx.getAddress(
          (trackResult["recipientInformation"] as Record<string, unknown>)[
              "address"
              ] as Record<string, unknown>,
      ),
    };

    const scanEvents = trackResult["scanEvents"] as Record<string, unknown>[];
    for (const scanEvent of scanEvents.reverse()) {
      const event = this.createEvent(
          trackingId,
          entity,
          scanEvent,
          updateMethod,
      );
      if (event && !entity.isEventIdExist(event.eventId)) {
        entity.addEvent(event);
      }
    }

    // sort the events based on when
    entity.sortEventsByWhen();

    // Process each missing event configuration
    for (const config of Fdx.missingEventConfigs) {
      if (config.checkMethod(entity)) {
        const baseEvent = config.getBaseEventMethod(entity);
        if (baseEvent) {
          const supplementEvent: Event = this.createSupplementEvent(trackingId, config.status, baseEvent.when as string, baseEvent.where as string);
          entity.addEvent(supplementEvent);
          entity.sortEventsByWhen();
        }
      }
    }

    return entity;
  }

  /**
   * Creates an Event object from a FedEx scan event.
   *
   * This function processes a FedEx scan event and converts it into an internal Event object,
   * including status codes, timestamps, location information, and any exception details.
   *
   * @param {TrackingID} trackingId - The tracking ID object containing the tracking number and operator.
   * @param {Entity} entity - The Entity object to which the Event will be added.
   * @param {Record<string, unknown>} scanEvent - The raw scan event data from FedEx API.
   * @param {string} updateMethod - The method used to update the tracking information.
   * @returns {Event} A new Event object populated with data from the FedEx scan event.
   */
  private static createEvent(
      trackingId: TrackingID,
      entity: Entity,
      scanEvent: Record<string, unknown>,
      updateMethod: string,
  ): Event {
    const status = Fdx.getStatusCode(entity, scanEvent);

    const trackingNum = trackingId.trackingNum;
    const event = new Event();
    // isoString
    const eventTime = scanEvent["date"] as string;
    const date = new Date(eventTime);
    const secondsSinceEpoch = Math.floor(date.getTime() / 1000);
    event.eventId =
        `ev_${trackingId.toString()}-${secondsSinceEpoch}-${status}`;
    event.status = status;
    event.what = StatusCode.getDesc(status);
    event.whom = "FedEx";
    event.when = eventTime;
    event.where = Fdx.getWhere(scanEvent);
    event.operatorCode = trackingId.operator;
    event.trackingNum = trackingNum;
    event.dataProvider = "FedEx";

    // process exception code if exists
    const exceptionCode = Fdx.getExceptionCode(scanEvent);
    if (exceptionCode !== undefined) {
      event.exceptionCode = exceptionCode;
      event.exceptionDesc = ExceptionCode.getDesc(exceptionCode);
    }

    // process notes
    const eventDescription = (scanEvent["eventDescription"] as string).trim();
    const sourceExceptionDesc = (scanEvent["exceptionDescription"] as string)
        .trim();
    const notes = sourceExceptionDesc.trim() === ""
        ? eventDescription
        : `${eventDescription}: ${sourceExceptionDesc}`;
    event.notes = notes.toLowerCase() === event.what.toLowerCase() ? "" : notes;
    // extra data and source data
    event.extra = {
      updateMethod: updateMethod,
      updatedAt: new Date().toISOString(),
    };
    event.sourceData = scanEvent;

    return event;
  }

  private static createSupplementEvent(
      trackingId: TrackingID,
      status: number,
      baseEventTime: string,
      where: string,
  ): Event {
    const event: Event = new Event();
    const date = new Date(baseEventTime);
    const timeZone = extractTimezone(baseEventTime);
    const [secondsSinceEpoch, when] = adjustDateAndFormatWithTimezone(date, timeZone);

    event.eventId = `ev_${trackingId.toString()}-${secondsSinceEpoch}-${status}`;
    event.operatorCode = "fdx";
    event.trackingNum = trackingId.trackingNum;
    event.status = status;
    event.what = StatusCode.getDesc(status);
    // Format the date to "2024-10-26T06:12:43+08:00"
    event.when = when;
    event.where = where;
    event.whom = "FedEx";
    event.notes = "Supplement event generated by Eagle1";
    event.dataProvider = "Eagle1";
    event.extra = {
      updateMethod: "system-generated",
      updatedAt: new Date().toISOString(),
    };
    event.sourceData = {};

    return event;
  }

}

