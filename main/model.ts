/**
 * @file model.ts
 * @description A singleton class for storing and retrieving key-value pairs where keys are numbers and values are strings.
 */
export class StatusCode {
  /** @private Singleton instance of StatusCode */
  private static instance: StatusCode = new StatusCode();

  /** @private Object storing key-value pairs with numeric keys and string values */
  private data: { [key: number]: string } = {};

  /**
   * Sets a key-value pair in the data store.
   * @param {number} key - The numeric key to associate with the value.
   * @param {string} value - The string value to store.
   */
  set(key: number, value: string): void {
    this.data[key] = value;
  }

  /**
   * Retrieves a value by its key.
   * @param {number} key - The numeric key to look up.
   * @returns {string | undefined} The value associated with the key, or undefined if not found.
   */
  get(key: number): string | undefined {
    return this.data[key];
  }

  /**
   * Initializes the StatusCode instance with a record of key-value pairs.
   * @param {Record<string, any>} record - An object with string keys and any values to initialize the store.
   */
  public static initialize(record: Record<string, any>): void {
    for (const [key, value] of Object.entries(record)) {
      const numericKey = Number(key);
      this.instance.set(numericKey, value);
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

  /** @private Object storing key-value pairs with numeric keys and string values */
  private data: { [key: number]: string } = {};

  /**
   * Sets a key-value pair in the data store.
   * @param {number} key - The numeric key to associate with the value.
   * @param {string} value - The string value to store.
   */
  set(key: number, value: string): void {
    this.data[key] = value;
  }

  /**
   * Retrieves a value by its key.
   * @param {number} key - The numeric key to look up.
   * @returns {string | undefined} The value associated with the key, or undefined if not found.
   */
  get(key: number): string | undefined {
    return this.data[key];
  }

  /**
   * Initializes the ExceptionCode instance with a record of key-value pairs.
   * @param {Record<string, any>} record - An object with string keys and any values to initialize the store.
   */
  public static initialize(record: Record<string, any>): void {
    for (const [key, value] of Object.entries(record)) {
      const numericKey = Number(key);
      this.instance.set(numericKey, value);
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
 * @author samshdn
 * @version 0.1.1
 */
export class ErrorRegistry {
  /** @private Singleton instance of ErrorRegistry */
  private static instance: ErrorRegistry = new ErrorRegistry();

  /** @private Object storing error codes as keys and their descriptions as values */
  private data: { [code: string]: string } = {};

  /**
   * Sets an error code and its description in the registry.
   * @param {string} code - The error code to associate with the description.
   * @param {string} description - The description of the error.
   */
  set(code: string, description: string): void {
    this.data[code] = description;
  }

  /**
   * Retrieves the description for a given error code.
   * @param {string} code - The error code to look up.
   * @returns {string | undefined} The description, or undefined if not found.
   */
  get(code: string): string | undefined {
    return this.data[code];
  }

  /**
   * Initializes the ErrorRegistry with a record of error codes and descriptions.
   * @param {Record<string, any>} record - An object with string keys and any values to initialize the registry.
   */
  static initialize(record: Record<string, any>): void {
    for (const [key, value] of Object.entries(record)) {
      this.instance.set(key, value);
    }
  }

  /**
   * Gets the error message for a given error code.
   * @param {string} code - The error code to look up.
   * @returns {string | undefined} The error message, or an empty string if not found.
   */
  static getMessage(code: string): string | undefined {
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

  /** @private List of supported carriers */
  static operators: string[] = ["fdx", "sfex"];

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
  static parse(strTrackingID: string): [string, TrackingID | undefined] {
    const array = strTrackingID.split("-");
    if ("" == strTrackingID.trim()) {
      return ["400-01", undefined];
    } else if (array.length != 2) {
      return ["400-05", undefined];
    } else {
      const operator: string = array[0];
      const trackingNum: string = array[1];
      if (!this.operators.includes(operator)) {
        return ["400-04", undefined];
      }
      if ("fdx" == operator) {
        const errorCode = this.checkFedExTrackingNum(trackingNum);
        if (errorCode != undefined) {
          return [errorCode, undefined];
        }
      }
      if ("sfex" == operator) {
        const errorCode = this.checkSFTrackingNum(trackingNum);
        if (errorCode != undefined) {
          return [errorCode, undefined];
        }
      }
      return ["", new TrackingID(operator, trackingNum)];
    }
  }

  /**
   * Validates a FedEx tracking number.
   * @param {string} trackingNum - The tracking number to validate.
   * @returns {string | undefined} An error code if invalid (e.g., "400-02"), or undefined if valid.
   */
  static checkFedExTrackingNum(trackingNum: string): string | undefined {
    if (trackingNum.length != 12) {
      return "400-02";
    }
    return undefined;
  }

  /**
   * Validates an SF Express tracking number.
   * @param {string} trackingNum - The tracking number to validate.
   * @returns {string | undefined} An error code if invalid (e.g., "400-02"), or undefined if valid.
   */
  static checkSFTrackingNum(trackingNum: string): string | undefined {
    if (trackingNum.length != 15 || !trackingNum.startsWith("SF")) {
      return "400-02";
    }
    return undefined;
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
  uuid?: string;
  /** Object identifier. ex: fdx-779879860040 */
  id?: string;
  /** Type of the object. ex: waybill */
  type?: string;
  /** Indicates if the event related to object is completed */
  completed?: boolean;
  /** Indicates the timestamp of the first event */
  creationTime?: string;
  /** Additional metadata for the object */
  extra?: Record<string, any>;
  /** Parameters associated with the object. ex:{phonenum:'1234'} */
  params?: Record<string, any>;
  /** List of events associated with the object */
  events?: Event[] = [];

  /**
   * Constructs an Entity instance.
   * @param {string} [id] - The object identifier.
   * @param {string} [type] - The type of the object.
   */
  constructor(
    id?: string,
    type?: string,
  ) {
    this.id = id;
    this.type = type;
  }

  /**
   * Converts the Entity instance to a JSON-compatible object.
   * @param {boolean} [fullData=false] - Whether to include full event data.
   * @returns {Record<string, any>} A structured object representing the object and its events.
   */
  public toJSON(fullData: boolean = false): Record<string, any> {
    const extra = this.extra;
    const additional = {
      ...(extra != null && ("origin" in extra) &&
        { origin: extra["origin"] }),
      ...(extra != null && ("destination" in extra) &&
        { destination: extra["destination"] }),
    };
    const entity = {
      uuid: this.uuid,
      id: this.id,
      type: this.type,
      creationTime: this.getCreationTime(),
      additional: Object.keys(additional).length > 0 ? additional : undefined,
    };

    const events = [];
    if (
      this.events !== undefined &&
      Object.keys(this.events).length > 0
    ) {
      for (const event of this.events) {
        events.push(event.toJSON(fullData));
      }
    }

    return { "entity": entity, "events": events };
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

    return this.events[this.events.length - 1];
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
   * Checks if the object is completed (has a status of 3500).
   * @returns {boolean} True if completed, false otherwise.
   */
  public isCompleted(): boolean {
    if (this.events === undefined) return false;

    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].status === 3500 || this.events[i].status === 3007) {
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
   * Gets the status of the last event.
   * @returns {{id: string | undefined, status: number | undefined, what: string | undefined} | undefined}
   * The last event's status details, or undefined if no events exist.
   */
  public getLastStatus() {
    const lastEvent = this.lastEvent();
    if (lastEvent === undefined) {
      return undefined;
    } else {
      return {
        id: this.id,
        status: lastEvent.status,
        what: lastEvent.what,
      };
    }
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
}

/**
 * A class representing an event associated with an object.
 * @author samshdn
 * @version 0.1.1
 * @date 2025-2-28
 */
export class Event {
  /** Unique identifier for the event */
  eventId?: string;
  /** Code of the operator responsible for the event */
  operatorCode?: string;
  /** Tracking number associated with the event */
  trackingNum?: string;
  /** Status code of the event */
  status?: number;
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

  /** Method of the last update */
  lastUpdateMethod?: string;
  /** Timestamp of the last update */
  lastUpdateTime?: string;
  /** Mode of transit for the event */
  transitMode?: string;

  /** Exception code if an error occurred */
  exceptionCode?: number;
  /** Description of the exception */
  exceptionDesc?: string;

  /** Notification code for the event */
  notificationCode?: number;
  /** Description of the notification */
  notificationDesc?: string;

  /** Additional metadata for the event */
  extra?: Record<string, any>;
  /** Raw source data for the event */
  sourceData?: Record<string, any>;

  /**
   * Converts the Event instance to a JSON-compatible object.
   * @param {boolean} [fullData=false] - Whether to include full source data.
   * @returns {Record<string, any>} A structured object representing the event.
   */
  public toJSON(fullData: boolean = false): Record<string, any> {
    const extra = this.extra;
    const result: Record<string, any> = {
      status: this.status,
      what: this.what,
      when: this.when,
      where: this.where,
      whom: this.whom,
      additional: {
        operatorCode: this.operatorCode,
        trackingNum: this.trackingNum,
        ...(this.notes != null && { notes: this.notes }),
        ...(this.dataProvider != null &&
          { dataProvider: this.dataProvider }),
        ...(extra != null && ("lastUpdateMethod" in extra) &&
          { lastUpdateMethod: extra["lastUpdateMethod"] }),
        ...(extra != null && ("lastUpdateTime" in extra) &&
          { lastUpdateTime: extra["lastUpdateTime"] }),
        ...(this.exceptionCode != null &&
          { exceptionCode: this.exceptionCode }),
        ...(this.exceptionDesc != null &&
          { exceptionDesc: this.exceptionDesc }),
        ...(this.notificationCode != null &&
          { notificationCode: this.notificationCode }),
        ...(this.notificationDesc != null &&
          { notificationDesc: this.notificationDesc }),
        ...(extra != null && ("transitMode" in extra) &&
          { transitMode: extra["transitMode"] }),
      },
    };

    if (fullData) {
      result["sourceData"] = this.sourceData;
    }

    return result;
  }
}
