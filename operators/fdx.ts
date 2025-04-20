/**
 * @file fdx.ts
 * @description A TypeScript class implementation for interacting with the FedEx tracking API.
 *              Provides functionality to authenticate with the API, fetch shipment tracking details,
 *              and convert FedEx tracking data into an internal format with associated events.
 */

import { logger } from "../tools/logger.ts";
import { jsonToMd5 } from "../tools/util.ts";
import {
  Entity,
  Event,
  ExceptionCode,
  StatusCode,
  TrackingID,
} from "../main/model.ts";

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
      DP: function (sourceData: Record<string, unknown>): number {
        if (sourceData["locationType"] == "ORIGIN_FEDEX_FACILITY") {
          return 3100; // Received by Carrier
        } else if (
          (sourceData["eventDescription"] as string).indexOf("Departed") >= 0
        ) {
          return 3250; // In-Transit
        }
        return 3001; // Logistics In-Progress
      },
      AR: 3002, // Arrived
      IT: function (sourceData: Record<string, unknown>): number {
        const exceptionCode = sourceData["exceptionCode"];
        if (exceptionCode == "67") {
          return 3450; // Final Delivery In-Progress
        } else {
          return 3001; // Logistics In-Progress
        }
      },
      AF: 3001, // Logistics In-Progress
      CC: function (sourceData: Record<string, unknown>): number | undefined {
        const desc = sourceData["eventDescription"] as string;
        if (desc.indexOf("Export") > 0) {
          return 3200; // Customs Clearance: Export Released
        } else if (desc.indexOf("Import") > 0) {
          return 3400; // Customs Clearance: Import Released
        }
      },
      OD: 3450, // Final Delivery In-Progress
      RR: 3450, // Delivery option requested
    },
    CD: {
      CD : function (sourceData: Record<string, unknown>): number | undefined {
        const desc = sourceData["eventDescription"] as string;
        if (desc.indexOf("Import") > 0) {
          return 3350; // Customs Clearance: Import In-Progress
        } else {
          return 3150; // Customs Clearance: Export In-Progress
        }
      }
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
  };

  private static exceptionCodeMap: Record<string, number> = {
    "08": 907, // Recipient, Not Available
    "17": 900, // Exception, Occurred
    "67": 900, // Exception, Occurred
    "A12": 900, // Exception, Occurred
  };

  /**
   * Retrieves the internal event code based on FedEx status code, event type, and source data.
   * @param {string} derivedStatusCode - The derived status code from FedEx.
   * @param {string} eventType - The type of event from FedEx.
   * @param {Record<string, unknown>} sourceData - The raw event data from FedEx.
   * @returns {number} The corresponding internal event code, or 3001 if not found.
   */
  static getStatusCode(
    derivedStatusCode: string,
    eventType: string,
    sourceData: Record<string, unknown>,
  ): number {
    const statusMap = Fdx.statusCodeMap[derivedStatusCode];
    if (!statusMap) return 3001;

    const value = statusMap[eventType];

    if (typeof value === "number") return value;

    if (typeof value === "function") {
      const result = value(sourceData);
      return typeof result === "number" ? result : 3001;
    }

    return 3001;
  }

  static getException(
    sourceData: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const code_original = sourceData["exceptionCode"] as string;
    if (code_original == "") {
      return undefined;
    }
    if (code_original in Fdx.exceptionCodeMap) {
      const execptionCode = Fdx.exceptionCodeMap[code_original];
      return {
        "exceptionCode": execptionCode,
        "exceptionDesc": ExceptionCode.getDesc(execptionCode),
        "notes": sourceData["eventDescription"] + ": " +
          sourceData["exceptionDescription"],
      };
    } else {
      return {
        "exceptionCode": -1,
        "exceptionDesc": "Unknown Exception",
        "notes": sourceData["eventDescription"] + ": " +
          sourceData["exceptionDescription"],
      };
    }
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
   * @param {TrackingID} trackingId - The tracking ID defined by eagle1.
   * @param {string} updateMethod - The method used to update the tracking information.
   * @returns {Promise<Entity | undefined>} A promise resolving to the tracking entity or undefined if not found.
   */
  static async whereIs(
    trackingId: TrackingID,
    updateMethod: string,
  ): Promise<Entity | string> {
    const trackingNum: string = trackingId.trackingNum;
    const result = await this.getRoute(trackingNum);
    if (result === undefined) return "404-01";

    return await this.convert(trackingId, result, updateMethod);
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
      const fedEx_Client_Secret: string = Deno.env.get("FedEx_Client_Secret") ??
        "";
      try {
        const response = await fetch(fedEx_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: fedEx_Client_ID,
            client_secret: fedEx_Client_Secret,
          }),
        });
        const data = await response.json();
        this.token = data["access_token"];
        this.expireTime = Date.now() + data["expires_in"] * 1000;
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
   * @returns {Promise<Record<string, unknown>>} A promise resolving to the raw API response data.
   * @throws {Error} If the API request fails.
   */
  static async getRoute(
    trackingNumber: string,
  ): Promise<Record<string, unknown>> {
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
      const FedEx_Track_API_URL: string = Deno.env.get("FedEx_Track_API_URL") ??
        "";
      const response = await fetch(FedEx_Track_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-locale": "en_US",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify(payload),
      });

      return await response.json();
    } catch (error) {
      logger.error("Error fetching shipment details:", error);
      throw error;
    }
  }

  /**
   * Converts raw FedEx API data into an internal object with events.
   * @param {TrackingID} trackingId - The tracking ID defined by eagle1.
   * @param {Record<string, unknown>} result - The raw API response data.
   * @param {string} updateMethod - The method used to update the tracking information.
   * @returns {Promise<Entity>} A promise resolving to the constructed Entity object.
   * @private
   */
  private static async convert(
    trackingId: TrackingID,
    result: Record<string, unknown>,
    updateMethod: string,
  ): Promise<Entity> {
    const entity: Entity = new Entity();
    const output = result["output"] as Record<string, unknown>;
    const completeTrackResults = output["completeTrackResults"] as [unknown];
    const completeTrackResult = completeTrackResults[0] as Record<
      string,
      unknown
    >;
    const trackResults = completeTrackResult["trackResults"] as [unknown];
    const trackResult = trackResults[0] as Record<string, unknown>;
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

    const scanEvents = trackResult["scanEvents"] as [unknown];
    for (let i = scanEvents.length - 1; i >= 0; i--) {
      const event = new Event();
      const scanEvent = scanEvents[i] as Record<string, unknown>;
      const fdxStatusCode = scanEvent["derivedStatusCode"] as string;
      const fdxEventType = scanEvent["eventType"] as string;
      const eagle1status: number = Fdx.getStatusCode(
        fdxStatusCode,
        fdxEventType,
        scanEvent,
      );
      const eventId = "ev_" + await jsonToMd5(scanEvent);
      if (entity.isEventIdExist(eventId)) continue;

      event.eventId = eventId;
      event.operatorCode = "fdx";
      event.trackingNum = completeTrackResult["trackingNumber"] as string;
      event.status = eagle1status;
      event.what = StatusCode.getDesc(eagle1status);
      event.when = scanEvent["date"] as string;
      const where = Fdx.getWhere(
        scanEvent["scanLocation"] as Record<string, unknown>,
      );
      if (where.trim().length > 0) {
        event.where = where;
      } else {
        if (scanEvent["locationType"] == "CUSTOMER") {
          event.where = "Customer location";
        }
      }
      event.whom = "FedEx";
      event.dataProvider = "FedEx";
      event.extra = {
        updateMethod: updateMethod,
        updatedOn: new Date().toISOString(),
      };
      const exception = Fdx.getException(scanEvent);
      if (exception == undefined) {
        event.notes = scanEvent["eventDescription"] as string;
      } else {
        event.exceptionCode = exception["exceptionCode"] as number;
        event.exceptionDesc = exception["exceptionDesc"] as string;
        event.notes = exception["notes"] as string;
      }
      event.sourceData = scanEvent;
      entity.addEvent(event as Event);
    }
    return entity;
  }
}
