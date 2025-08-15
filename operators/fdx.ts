/**
 * @file fdx.ts
 * @description A TypeScript class implementation for interacting with the FedEx tracking API.
 *              Provides functionality to authenticate with the API, fetch shipment tracking details,
 *              and convert FedEx tracking data into an internal format with associated events.
 */

import {
  DataUpdateMethod,
  Entity,
  Event,
  ExceptionCode,
  StatusCode,
  TrackingID,
  UserError,
} from "../main/model.ts";
import { config } from "../config.ts";
import { logger } from "../tools/logger.ts";

/**
 * A class to interact with the FedEx tracking API and manage shipment tracking information.
 */
export class Fdx {
  /** @type {string} The current authentication token for FedEx API requests. */
  private static token: string;
  /** @type {number} The expiration time of the token in milliseconds since epoch. Initially 0. */
  private static expireTime: number = 0;
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
        const eventDescrition = sourceData["eventDescription"] as string;
        if (
          locationType === "SORT_FACILITY" &&
          /destination/i.test(eventDescrition)
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
      CA: 3007, // Process Stopped
    },
  };

  private static exceptionCodeMap: Record<string, number> = {
    "08": 907, // Recipient, Not Available
    "29": 909, // Rerouted
  };

  /**
   * Fetches and manages the FedEx API authentication token.
   * @returns {Promise<string>} A promise resolving to the current or newly fetched token.
   * @throws {Error} If the token cannot be retrieved from the FedEx API.
   */
  static async getToken(): Promise<string> {
    // Refresh the token 5 seconds before expiration.
    if (Date.now() > this.expireTime - 5000) {
      const fdxApiUrl: string = config.fdx.apiUrl ?? "";
      const fdxClientId: string = Deno.env.get("FDX_CLIENT_ID") ?? "";
      const fdxClientSecret: string = Deno.env.get("FDX_CLIENT_SECRET") ??
        "";
      let data;
      try {
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
        data = await response.json();
      } catch (error) {
        console.error("Could not get JSON:", error);
        throw error;
      }

      if (data["access_token"]) {
        this.token = data["access_token"];
        this.expireTime = Date.now() + data["expires_in"] * 1000;
      } else {
        if (data["errors"]) {
          const code = data["errors"][0]?.code;
          switch (code) {
            case "BAD.REQUEST.ERROR":
              throw new UserError("400-08");
            case "NOT.AUTHORIZED.ERROR":
              throw new UserError("400-09");
            default:
              throw new Error(`Unexpected error code from FedEx API: ${code}`);
          }
        } else {
          throw new Error("Failed to retrieve token from FedEx API: No access_token or errors provided in response");
        }
      }
    }

    if (this.expireTime > 0) {
      return this.token;
    } else {
      return "";
    }
  }

  /**
   * Retrieves the current location and tracking details for a given tracking number.
   * @param {TrackingID} trackingIds - The tracking ID(s) defined by eagle1.
   * @param {string} updateMethod - The method used to update the tracking information.
   * @returns {Promise<Entity | undefined>} A promise resolving to the tracking entity or undefined if not found.
   */
  static async whereIs(
    trackingIds: TrackingID[],
    updateMethod: string,
  ): Promise<Entity[]> {
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
    return (address["city"] ?? "") + " " +
      (address["stateOrProvinceCode"] ?? "") + " " +
      address["countryName"];
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

    return await response.json();
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
}
