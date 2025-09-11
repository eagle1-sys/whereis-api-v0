/**
 * @file model.ts
 * @description A singleton class for storing and retrieving key-value pairs where keys are numbers and values are strings.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
export class StatusCode {
  /** @private Singleton instance of StatusCode */
  private static instance: StatusCode = new StatusCode();

  /** @private Object storing key-value pairs with numeric keys and string values */
  private data: Map<number, string> = new Map();

  private constructor() {}

  /**
   * Sets a key-value pair in the data store.
   * @param {number} key - The numeric key to associate with the value.
   * @param {string} value - The string value to store.
   */
  private set(key: number, value: string): void {
    this.data.set(key, value);
  }

  /**
   * Retrieves a value by its key.
   * @param {number} key - The numeric key to look up.
   * @returns {string | undefined} The value associated with the key, or undefined if not found.
   */
  private get(key: number): string | undefined {
    return this.data.get(key);
  }

  /**
   * Initializes the StatusCode instance with a record of key-value pairs.
   * @param {Record<string, unknown>} record - An object with string keys and any values to initialize the store.
   */
  public static initialize(record: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(record)) {
      const numericKey = Number(key);
      if (!isNaN(numericKey)) {
        this.instance.set(numericKey, value as string);
      }
    }
  }

  /**
   * Gets the description associated with a numeric code.
   * @param {number} code - The numeric code to look up.
   * @returns {string} The description for the code, or an empty string if not found.
   */
  public static getDesc(code: number): string {
    return this.instance.get(code) ?? "";
  }
}

export class ExceptionCode {
  /** @private Singleton instance of ExceptionCode */
  private static instance: ExceptionCode = new ExceptionCode();

  /** @private Map storing key-value pairs with numeric keys and string values */
  private data: Map<number, string> = new Map();

  private constructor() {}

  /**
   * Sets a key-value pair in the data store.
   * @param {number} key - The numeric key to associate with the value.
   * @param {string} value - The string value to store.
   */
  private set(key: number, value: string): void {
    this.data.set(key, value);
  }

  /**
   * Retrieves a value by its key.
   * @param {number} key - The numeric key to look up.
   * @returns {string | undefined} The value associated with the key, or undefined if not found.
   */
  private get(key: number): string | undefined {
    return this.data.get(key);
  }

  /**
   * Initializes the ExceptionCode instance with a record of key-value pairs.
   * @param {Record<string, unknown>} record - An object with string keys and any values to initialize the store.
   */
  public static initialize(record: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(record)) {
      const numericKey = Number(key);
      if (!isNaN(numericKey)) {
        this.instance.set(numericKey, value as string);
      }
    }
  }

  /**
   * Gets the description associated with a numeric code.
   * @param {number} code - The numeric code to look up.
   * @returns {string} The description for the code, or an empty string if not found.
   */
  public static getDesc(code: number): string {
    return this.instance.get(code) ?? "";
  }
}

/**
 * A singleton class for managing error codes and their descriptions.
 */
export class ErrorRegistry {
  /** @private Singleton instance of ErrorRegistry */
  private static instance: ErrorRegistry = new ErrorRegistry();

  /** @private Map storing error codes as keys and their descriptions as values */
  private data: Map<string, string> = new Map();

  private constructor() {}

  /**
   * Sets an error code and its description in the registry.
   * @param {string} code - The error code to associate with the description.
   * @param {string} description - The description of the error.
   */
  private set(code: string, description: string): void {
    this.data.set(code, description);
  }

  /**
   * Retrieves the description for a given error code.
   * @param {string} code - The error code to look up.
   * @returns {string | undefined} The description, or undefined if not found.
   */
  private get(code: string): string | undefined {
    return this.data.get(code);
  }

  /**
   * Initializes the ErrorRegistry with a record of error codes and descriptions.
   * @param {Record<string, unknown>} record - An object with string keys and any values to initialize the registry.
   */
  public static initialize(record: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(record)) {
      this.instance.set(key, value as string);
    }
  }

  /**
   * Retrieves a message for a given error code and optionally replaces placeholders with provided parameters.
   *
   * @param code - The error code to look up in the error registry.
   * @returns The error message with placeholders replaced if params are provided, or the original message if not.
   *          Returns an empty string if the error code is not found in the registry.
   */
  public static getMessage(code: string): string {
    return this.instance.get(code) ?? "";
  }
}

/**
 * A class representing a tracking ID with a carrier and tracking number.
 * @author samshdn
 * @version 0.1.1
 */
export class TrackingID {
  operator: string;
  trackingNum: string;


  /**
   * @private Constructor for creating a TrackingID instance.
   * @param {string} operator - The carrier code (e.g., "fdx" for FedEx).
   * @param {string} trackingNum - The tracking number associated with the carrier.
   */
  private constructor(operator: string, trackingNum: string) {
    this.operator = operator;
    this.trackingNum = trackingNum;
  }

  /**
   * Converts the TrackingID instance to a string representation.
   * @returns {string} The carrier and tracking number joined by a hyphen (e.g., "fdx-123456789012").
   */
  toString(): string {
    return this.operator + "-" + this.trackingNum;
  }

  /**
   * Parses a tracking ID string into a TrackingID object or returns an error code.
   * @param {string} strTrackingID - The tracking ID string to parse (e.g., "fdx-123456789012").
   * @returns [string, TrackingID] An array containing an error code (if any) and the parsed TrackingID object (or undefined).
   */
  static parse(strTrackingID: string): TrackingID {
    const trimmedID = strTrackingID.trim();
    if (trimmedID === "") {
      throw new AppError("400-01","400BA: model - TRACKING_ID");
    }

    const [operator, trackingNum] = trimmedID.split("-");
    if (!operator || !trackingNum) {
      throw new AppError("400-05","400BB: model - URL_FORMAT");
    }

    const lowerCaseOperator = operator.toLowerCase();
    if (!OperatorRegistry.include(lowerCaseOperator)) {
      throw new AppError("400-04", `400BC: model - OPERATOR_CODE[${lowerCaseOperator}]`);
    }

    switch (lowerCaseOperator) {
      case "fdx":
        this.checkFedExTrackingNum(trackingNum);
        break;
      case "sfex":
        this.checkSFTrackingNum(trackingNum);
        break;
    }

    return new TrackingID(lowerCaseOperator, trackingNum);
  }

  /**
   * Validates a FedEx tracking number.
   * @param {string} trackingNum - The tracking number to validate.
   * @returns {string | undefined} An error code if invalid (e.g., "400-02"), or undefined if valid.
   */
  static checkFedExTrackingNum(trackingNum: string): void {
    if (trackingNum.length != 12) {
      throw new AppError("400-02","400BD: model - FDX_LENGTH");
    }
  }

  /**
   * Validates an SF Express tracking number.
   * @param {string} trackingNum - The tracking number to validate.
   * @returns {string | undefined} An error code if invalid (e.g., "400-02"), or undefined if valid.
   */
  static checkSFTrackingNum(trackingNum: string): void {
    if (trackingNum.length != 15 || !trackingNum.startsWith("SF")) {
      throw new AppError("400-02", "400BE: model - SFEX_FORMAT");
    }
  }
}

/**
 * A class representing an object with associated events and metadata.
 * @author samshdn
 * @version 0.1.1
 * @date 2025-2-28
 */
export class Entity {
  /** Unique identifier for the object */
  uuid: string;
  /** Object identifier. ex: fdx-779879860040 */
  id: string;
  /** Type of the object. ex: waybill */
  type: string;
  /** Indicates if the event related to object is completed */
  completed: boolean;
  /** Indicates the timestamp of the first event */
  creationTime: string;
  /** Additional metadata for the object */
  extra: Record<string, string>;
  /** Parameters associated with the object. ex:{phonenum:'1234'} */
  params: Record<string, string>;
  /** List of events associated with the object */
  events: Event[] = [];

  /**
   * Constructs an Entity instance.
   */
  constructor() {
    this.uuid = "";
    this.id = "";
    this.type = "";
    this.completed = false;
    this.creationTime = "";
    this.extra = {};
    this.params = {};
    this.events = [];
  }

  /**
   * Converts the Entity instance to a JSON-compatible object.
   * @param {boolean} [fullData=false] - Whether to include full event data.
   * @returns {Record<string, unknown>} A structured object representing the object and its events.
   */
  public toJSON(fullData: boolean = false): Record<string, unknown> {
    const extra = this.extra || {};
    const additional: Record<string, unknown> = {};
    // sort the events first to ensure getCreationTime()/lastEvent() works correctly
    this.events.sort((a, b) => {
      const dateA = a.when ? new Date(a.when).getTime() : 0;
      const dateB = b.when ? new Date(b.when).getTime() : 0;
      return dateA - dateB;
    });

    // Add origin and destination if they exist in extra
    ["origin", "destination"].forEach((key) => {
      if (key in extra) additional[key] = extra[key];
    });

    const entity = {
      id: this.id,
      type: this.type,
      uuid: this.uuid,
      createdAt: this.getCreationTime(),
      ...(Object.keys(additional).length > 0 && { additional }),
    };

    const events = this.events?.map((event) => event.toJSON(fullData)) || [];

    return { entity, events };
  }

  /**
   * Returns the number of events associated with the object.
   * @returns {number} The number of events, or 0 if none exist.
   */
  public eventNum(): number {
    return this.events === undefined ? 0 : this.events.length;
  }

  /**
   * Adds an event to the object's event list.
   * @param {Event} event - The event to add.
   */
  public addEvent(event: Event) {
    if (this.events == undefined) {
      this.events = [];
    }
    this.events.push(event);
  }

  /**
   * Retrieves the most recent event.
   * @returns {Event | undefined} The last event, or undefined if no events exist.
   */
  public lastEvent(): Event | undefined {
    if (this.events === undefined) return undefined;

    // sort the events by "when" in ascending order
    this.events.sort((a, b) => {
      const dateA = a.when ? new Date(a.when).getTime() : 0;
      const dateB = b.when ? new Date(b.when).getTime() : 0;
      return dateA - dateB;
    });

    return this.events[this.events.length - 1];
  }

  public eventIds(): string[] {
    if (this.events === undefined) return [];

    return this.events.map((event) => event.eventId);
  }

  /**
   * Checks if the entity includes an event with the specified status.
   *
   * @param status - The status code to check for in the entity's events.
   * @returns A boolean indicating whether an event with the specified status exists.
   *          Returns true if an event with the given status is found, false otherwise.
   *          Also returns false if the entity has no events.
   */
  public includeStatus(status: number): boolean {
    if (this.events === undefined) return false;

    for (const event of this.events) {
      if (event.status === status) {
        return true;
      }
    }
    return false;
  }

  /**
   * Retrieves the most recent major event (status is a multiple of 100).
   * @returns {Event | undefined} The last major event, or undefined if none exist.
   */
  public lastMajorEvent(): Event | undefined {
    if (this.events === undefined) return undefined;

    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event.status !== undefined && event.status % 100 === 0) {
        return event;
      }
    }
  }

  /**
   * Retrieves the most recent minor event (status ends in 50).
   * @returns {Event | undefined} The last minor event, or undefined if none exist.
   */
  public lastMinorEvent(): Event | undefined {
    if (this.events === undefined) return undefined;

    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event.status !== undefined && event.status % 100 === 50) {
        return event;
      }
    }
  }

  /**
   * Retrieves the most recent important event (status ends in 50 or 100).
   * @returns {Event | undefined} The last important event, or undefined if none exist.
   */
  public lastImportantEvent(): Event | undefined {
    if (this.events === undefined) return undefined;

    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event.status !== undefined && event.status % 50 === 0) {
        return event;
      }
    }
  }

  /**
   * Checks if the object is completed (has a status of 3500).
   * @returns {boolean} True if completed, false otherwise.
   */
  public isCompleted(): boolean {
    if (this.events === undefined) return false;

    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].status === 3500 || this.events[i].status === 3009) {
        return true;
      }
    }
    return false;
  }

  /**
   * Gets the creation time of the object based on the first event.
   * @returns {string} The creation time, or an empty string if no events exist.
   */
  public getCreationTime(): string {
    if (
      this.events === undefined ||
      this.events.length == 0
    ) return "";

    const when = this.events[0]?.when;
    return when ? when : "";
  }

  /**
   * Retrieves the status details of the last event associated with this entity.
   *
   * This method fetches the most recent event and extracts key information
   * including the entity's ID, the event's status code, and the event description.
   *
   * @returns {Record<string, unknown> | undefined} An object containing the status details of the last event, or undefined if no events exist.
   *   The returned object has the following structure:
   *   - id: The ID of the entity (string | undefined)
   *   - status: The status code of the last event (number | undefined)
   *   - what: The description of the last event (string | undefined)
   */
  public getLastStatus(): Record<string, unknown> | undefined {
    const lastEvent = this.lastEvent();
    if (!lastEvent) return undefined;

    return {
      id: this.id,
      status: lastEvent.status,
      what: lastEvent.what,
      whom: lastEvent.whom,
      when: lastEvent.when,
      where: lastEvent.where,
      notes: lastEvent.notes,
    };
  }

  /**
   * Checks if an event with the given ID exists in the object's event list.
   * @param {string} eventId - The event ID to check.
   * @returns {boolean} True if the event ID exists, false otherwise.
   */
  public isEventIdExist(eventId: string): boolean {
    if (this.events === undefined) return false;

    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event.eventId == eventId) {
        return true;
      }
    }

    return false;
  }

  /**
   * Sorts the events associated with this entity based on their timestamps.
   *
   * This method arranges the events in chronological order, using the 'when' property
   * of each event. Events without a 'when' property are treated as occurring at the
   * Unix epoch (January 1, 1970).
   *
   * @remarks
   * This method modifies the original events array in place.
   *
   * @returns {void} This method does not return a value.
   */
  public sortEventsByWhen(): void {
    this.events.sort((a, b) => {
      const dateA = a.when ? new Date(a.when).getTime() : 0;
      const dateB = b.when ? new Date(b.when).getTime() : 0;
      return dateA - dateB;
    });
  }
}

/**
 * A class representing an event associated with an entity.
 */
export class Event {
  /** Unique identifier for the event */
  eventId: string;
  /** Tracking number associated with the event */
  trackingNum?: string;
  /** Code of the operator responsible for the event */
  operatorCode?: string;
  /** Status code of the event */
  status: number;
  /** Description of the event */
  what?: string;
  /** Timestamp of when the event occurred */
  when?: string;
  /** Location where the event occurred */
  where?: string;
  /** Operator associated with the event */
  whom?: string;
  /** Additional notes about the event */
  notes?: string;
  /** Provider of the event data */
  dataProvider?: string;

  /** Exception code if an error occurred */
  exceptionCode?: number;
  /** Description of the exception */
  exceptionDesc?: string;

  /** Notification code for the event */
  notificationCode?: number;
  /** Description of the notification */
  notificationDesc?: string;

  /** Additional metadata for the event */
  extra?: Record<string, unknown>;
  /** Raw source data for the event */
  sourceData: Record<string, unknown>;

  constructor() {
    this.eventId = "";
    this.status = -1;
    this.extra = {};
    this.sourceData = {};
  }

  /**
   * Converts the Event instance to a JSON-compatible object.
   * @param {boolean} [fullData=false] - Whether to include full source data.
   * @returns {Record<string, unknown>} A structured object representing the event.
   */
  public toJSON(fullData: boolean = false): Record<string, unknown> {
    const result: Record<string, unknown> = {
      status: this.status,
      what: this.what,
      whom: this.whom,
      when: this.when,
      where: this.where,
    };

    if (this.notes != null) result.notes = this.notes;

    const additional: Record<string, unknown> = {
      trackingNum: this.trackingNum,
      operatorCode: this.operatorCode,
      dataProvider: this.dataProvider,
      updateMethod: this.extra?.updateMethod,
      updatedAt: this.extra?.updatedAt,
    };

    if (this.exceptionCode != null) {
      additional.exceptionCode = this.exceptionCode;
    }
    if (this.exceptionDesc != null) {
      additional.exceptionDesc = this.exceptionDesc;
    }
    if (this.notificationCode != null) {
      additional.notificationCode = this.notificationCode;
    }
    if (this.notificationDesc != null) {
      additional.notificationDesc = this.notificationDesc;
    }

    if (this.extra != null && "transitMode" in this.extra) {
      additional.transitMode = this.extra.transitMode;
    }

    result.additional = additional;

    if (fullData && this.sourceData != null) {
      result.sourceData = this.sourceData;
    }

    return result;
  }
}

export class AppError extends Error {
  code: string;
  uniqueString?: string;

  constructor(code: string, uniqueString?: string) {
    super(ErrorRegistry.getMessage(code));
    this.code = code;
    if(uniqueString) {
      this.uniqueString = uniqueString;
    }
  }

  /**
   * Extracts HTTP status code from error code string
   * @returns Numeric HTTP status code
   * @throws Error if errorCode format is invalid
   */
  public getHttpStatusCode(): number {
    const parts = this.code.split("-");
    const httpStatusCode = Number(parts[0]);
    // validate the first part
    if (isNaN(httpStatusCode)) {
      throw new Error("Invalid parameter");
    }

    return httpStatusCode;
  }

  /**
   * Retrieves a message for a given error code and optionally replaces placeholders with provided parameters.
   *
   * @returns The error message with placeholders replaced if params are provided, or the original message if not.
   *          Returns an empty string if the error code is not found in the registry.
   */
  public getMessage(): string {
    const message = this.message;
    if (this.uniqueString) {
      return message + " [" + this.uniqueString + "]";
    }
    return message;
  }
}

/**
 * A singleton class for managing data retrieval methods and their attributes.
 */
export class DataUpdateMethod {
  /** @private Singleton instance of DataRetrievalMethod */
  private static instance: DataUpdateMethod = new DataUpdateMethod();

  /** @private Map storing method names as keys and their attributes as values */
  private data: Map<string, Record<string, string>> = new Map();

  private constructor() {}

  /**
   * Sets a data retrieval method and its attributes in the registry.
   * @param {string} method - The method name to associate with the attributes.
   * @param {Record<string, string>} attributes - The attributes of the method.
   */
  private set(method: string, attributes: Record<string, string>): void {
    this.data.set(method, attributes);
  }

  /**
   * Initializes the DataRetrievalMethod with a record of methods and their attributes.
   * @param {Record<string, Record<string, string>>} record - An object with method names as keys and their attributes as values.
   */
  public static initialize(
    record: Record<string, Record<string, string>>,
  ): void {
    for (const [method, attributes] of Object.entries(record)) {
      this.instance.set(method, attributes);
    }
  }

  /**
   * Gets the display text for a given method.
   * @param {string} method - The method name to look up.
   * @returns {string} The display text for the method.
   */
  public static getDisplayText(method: string): string {
    return method.charAt(0).toUpperCase() + method.slice(1);
  }
}

/**
 * A singleton class for storing and retrieving API parameters metadata.
 */
export class ApiParams {
  /** @private Singleton instance of ApiParams */
  private static instance: ApiParams = new ApiParams();

  /** @private Object storing the API parameters metadata */
  private data: Record<string, unknown> = {};

  private constructor() {}

  /**
   * Sets the API parameters metadata.
   * @param {Record<string, unknown>} value - The API parameters metadata to store.
   */
  private set(value: Record<string, unknown>): void {
    this.data = value;
  }

  /**
   * Retrieves the description for a given error code.
   * @param {string} code - The error code to look up.
   * @returns {string | undefined} The description, or undefined if not found.
   */
  private get(code: string): Record<string, unknown> | undefined {
    return (this.data as Record<string, Record<string, unknown>>)[code];
  }

  /**
   * Initializes the ApiParams instance with the API parameters metadata.
   * @param {Record<string, unknown>} data - The API parameters metadata to initialize the store.
   */
  public static initialize(data: Record<string, unknown>): void {
    this.instance.set(data);
  }


  /**
   * Retrieves the parameter names for a specific API endpoint and data provider.
   *
   * This function looks up the API parameters metadata for the given endpoint
   * and data provider, and returns an array of parameter names.
   *
   * @param endpoint - The API endpoint for which to retrieve parameter names.
   * @param dataProvider - The data provider within the endpoint for which to retrieve parameter names.
   * @returns An array of parameter names for the specified endpoint and data provider.
   *          Returns an empty array if no parameters are found or if the metadata is invalid.
   */
  public static getParamNames(
    endpoint: string,
    dataProvider: string,
  ): string[] {
    // Retrieve API parameters metadata for the specified endpoint
    const apiParams = this.instance.get(endpoint) as
      | Record<string, unknown>
      | undefined;
    if (!apiParams || typeof apiParams !== "object") {
      return [];
    }

    // Retrieve parameter names for the common parameters first
    let paraNames : string[] = [] ;
    const commonParams = apiParams["common"] as
        | Record<string, string>
        | undefined;
    if (commonParams && typeof commonParams === "object") {
      paraNames = Object.keys(commonParams);
    }

    // Retrieve parameter names for the specific data provider
    const providerParams = apiParams[dataProvider] as
      | Record<string, string>
      | undefined;
    if (providerParams && typeof providerParams === "object") {
      paraNames = paraNames.concat(Object.keys(providerParams));
    }

    return paraNames;
  }
}

export class OperatorRegistry {

  private static operators: string[] ;
  /** @private Singleton instance of OperatorRegistry */
  private static instance: OperatorRegistry = new OperatorRegistry();

  /** @private Map storing operator codes as keys and their details as values */
  private data: Map<string, Record<string, unknown>> = new Map();

  private constructor() {}

  /**
   * Sets an operator's details in the registry.
   * @param {string} code - The operator code to associate with the details.
   * @param {Record<string, unknown>} details - The details of the operator.
   */
  private set(code: string, details: Record<string, unknown>): void {
    this.data.set(code, details);
  }

  /**
   * Initializes the OperatorRegistry with a record of operator codes and their details.
   * @param {Record<string, unknown>} record - An object with operator codes as keys and their details as values.
   */
  public static initialize(record: Record<string, unknown>): void {
    for (const [code, details] of Object.entries(record)) {
      if (typeof details === 'object' && details !== null) {
        this.instance.set(code, details as Record<string, unknown>);
      }
    }
    this.operators = Array.from(this.instance.data.keys());
  }

  public static include( operator: string): boolean {
    return this.operators.includes(operator);
  }

  /**
   * Gets all active operator codes.
   * @returns {string[]} An array of all operator codes.
   */
  public static getActiveOperatorCodes(): string[] {
    return Array.from(this.instance.data.entries())
        .filter(([_, details]) => details.active === true)
        .map(([code, _]) => code);
  }

  /**
   * Gets all active operator codes and names.
   * @returns {Array<{code: string, name: string}>} An array of objects containing the code and name of all active operators.
   */
  public static getActiveOperators(): Array<{code: string, name: string}> {
    return Array.from(this.instance.data.entries())
        .filter(([_, details]) => details.active === true)
        .map(([code, details]) => ({
          code: code,
          name: details.name as string
        }));
  }

}

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JSONValue }
  | JSONValue[];
