/**
 * @file db_postgres.ts
 * @description The module encapsulates database interactions for:
 * - Object management (insert, update, query)
 * - Event tracking (insert, query)
 * - Status monitoring
 * - Tracking number management
 *
 *  @copyright (c) 2025, the Eagle1 authors
 *  @license BSD 3-Clause License
 */

import postgres from "postgresjs";
import {DatabaseWrapper} from "./db_wrapper.ts";

import { logger } from "../tools/logger.ts";
import { JSONValue } from "../main/model.ts";
import {DataUpdateMethod,Entity,Event,TrackingID} from "../main/model.ts";

/**
 * Ensures that the input object is safe to be serialized as JSON.
 * This function recursively processes the input to handle nested objects and arrays,
 * converting any non-JSON-safe values to strings.
 *
 * @param obj - The object to be processed. Can be of any type.
 * @returns A JSON-safe version of the input. The return type is JSONValue, which can be:
 *          - A string, number, boolean, or null for primitive values
 *          - An array of JSONValue for array inputs
 *          - An object with string keys and JSONValue values for object inputs
 *          - A string representation for any other type of input
 */
function ensureJSONSafe(obj: unknown): JSONValue {
  if (obj !== null && Array.isArray(obj)) {
    return obj.map(ensureJSONSafe);
  }

  if (typeof obj === "object" && obj !== null) {
    return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, ensureJSONSafe(v)]),
    );
  }

  if (
      typeof obj === "string" || typeof obj === "number" ||
      typeof obj === "boolean" || obj === null
  ) {
    return obj;
  }
  return String(obj);
}

export class PostgresWrapper implements DatabaseWrapper {

  private readonly sql: ReturnType<typeof postgres>;

  constructor(sql: ReturnType<typeof postgres>) {
    this.sql = sql;
  }

  /**
   * Performs a simple database connection test.
   *
   * This method executes a trivial SQL query to check if the database connection is active and responsive.
   * It's typically used for health checks or to verify the database connectivity.
   *
   * @returns {Promise<number>} A promise that resolves to 1 if the connection is successful.
   *                            The value 1 is returned as it's the result of the test query 'SELECT 1'.
   * @throws {Error} If the database connection fails or the query execution encounters an error.
   */
  async ping(): Promise<number> {
    const testResult = await this.sql`SELECT 1 as connection_test`;
    return testResult[0].connection_test;
  }

  /**
   * Inserts a new entity into the database.
   *
   * This function inserts the given entity into the 'entities' table and, if successful and the entity has events,
   * also inserts those events into the database using a manual pull update method.
   *
   * @param entity - The Entity object to be inserted into the database.
   *                 It should contain all necessary properties such as uuid, id, type, creation time, completion status, extra data, and parameters.
   *
   * @returns A Promise that resolves to:
   *          - 1 if the insertion was successful (note: this doesn't necessarily mean the entity was inserted, just that the operation completed)
   *          - undefined if the operation failed or no insertion occurred
   *
   * @throws Will throw an error if the database operation fails.
   */
  async insertEntity(entity: Entity): Promise<number | undefined> {
    await this.sql.begin(async (_sql: ReturnType<typeof postgres>) => {
      const result = await this.sql`
        INSERT INTO entities (uuid, id, type, creation_time, completed, extra, params)
        VALUES (${entity.uuid},
                ${entity.id},
                ${entity.type},
                ${entity.getCreationTime()},
                ${entity.isCompleted()},
                ${this.sql.json(entity.extra)},
                ${this.sql.json(entity.params)}) `;

      if (result.count == 1 && entity.events != undefined) {
        await this.insertEvents(entity.events, DataUpdateMethod.getDisplayText("manual-pull"));
      }
    });

    return 1;
  }

  /**
   * Updates an entity in the database, including its associated events.
   *
   * This function performs three main operations:
   * 1. Updates the entity's completion status if it's completed.
   * 2. Inserts new events associated with the entity.
   * 3. Removes events that are no longer associated with the entity.
   *
   * All operations are performed within a single database transaction to ensure data consistency.
   *
   * @param entity - The Entity object containing updated information.
   * @param eventIdsNew - An array of event IDs that need to be added to the entity.
   * @param eventIdsToBeRemoved - An array of event IDs that need to be removed from the entity.
   * @returns A Promise that resolves to true if the update operation is successful.
   *          Note: The boolean return doesn't indicate success or failure, as errors will throw exceptions.
   * @throws Will throw an error if any database operation fails.
   */
  async updateEntity(entity: Entity, eventIdsNew: string[], eventIdsToBeRemoved: string[]): Promise<boolean> {
    const updateMethod = DataUpdateMethod.getDisplayText("auto-pull");

    await this.sql.begin(async (_sql: ReturnType<typeof postgres>) => {
      // update the entity record
      // step 1: update the entity record ONLY when the entity is completed
      if (entity.isCompleted()) {
        await this.sql`update entities set completed = true where id = ${entity.id as string}`;
      }

      // step 2: insert new events
      if (eventIdsNew.length > 0) {
        const events: Event[] = entity.events.filter((event) =>
            eventIdsNew.includes(event.eventId)
        );
        await this.insertEvents(events, updateMethod);
      }

      // step 3: remove events that are not in the updated entity
      if (eventIdsToBeRemoved.length > 0) {
        for (const eventId of eventIdsToBeRemoved) {
          logger.info(`${updateMethod}: Delete exist event with ID ${eventId}`);
          await this.deleteEvent(eventId);
        }
      }
    });

    return true;
  }

  /**
   * Deletes an entity and its associated events from the database.
   *
   * This function performs two delete operations:
   * 1. Deletes all events associated with the given tracking ID.
   * 2. Deletes the entity with the given tracking ID.
   *
   * @param trackingID - The unique identifier for the entity to be deleted.
   *                     It contains the operator code and tracking number.
   *
   * @returns A Promise that resolves to the total number of rows deleted from both
   *          the events and entities tables. If no rows were deleted, it may return undefined.
   */
  async deleteEntity(trackingID: TrackingID): Promise<number | undefined> {
    // delete events
    const result1 = await this.sql`
      DELETE FROM events
      WHERE operator_code = ${trackingID.operator} AND tracking_num = ${trackingID.trackingNum}
    `;

    const result2 = await this.sql`
      DELETE
      FROM entities
      WHERE id = ${trackingID.toString()}
    `;

    return result1.count + result2.count;
  }

  /**
   * Refreshes an entity in the database by deleting the existing entry and inserting a new one.
   * This ensures that the database always contains the most up-to-date information for the entity.
   *
   * @param trackingId - The unique identifier for tracking the entity. It's used to locate and delete the existing entity.
   * @param entity - The new Entity object containing the updated information to be inserted into the database.
   * @returns A Promise that resolves to true if the refresh operation is successful.
   *          The boolean return value doesn't indicate success or failure, as errors will throw exceptions.
   * @throws Will throw an error if either the delete or insert operation fails.
   */
  async refreshEntity(trackingId: TrackingID, entity: Entity): Promise<boolean> {
    await this.sql.begin(async (_sql: ReturnType<typeof postgres>) => {
      // Delete and insert the entity to ensure the latest data
      await this.deleteEntity(trackingId);
      await this.insertEntity(entity);
    });
    return true;
  }

  /**
   * Queries the database for an entity based on the provided tracking ID.
   *
   * This function retrieves an entity from the database along with its associated events.
   * If the entity is found but has no associated events, it returns undefined.
   *
   * @param trackingID - The unique identifier for the entity to be queried.
   *                     It contains the operator code and tracking number.
   *
   * @returns A Promise that resolves to:
   *          - An Entity object if the entity is found and has associated events.
   *          - undefined if the entity is not found or has no associated events.
   */
  async queryEntity(trackingID: TrackingID): Promise<Entity | undefined> {
    const rows = await this.sql`
        SELECT uuid,
               id,
               type,
               completed,
               extra,
               params,
               creation_time
        FROM entities
        WHERE id = ${trackingID.toString()};
    `;

    let entity: Entity | undefined;
    let events: Event[];
    if (rows.length == 1) {
      // query events from database
      events = await this.queryEvents(trackingID);
      if (events.length === 0) {
        return undefined;
      }

      // create entity object
      entity = new Entity();
      const row = rows[0];
      entity.uuid = row.uuid;
      entity.id = row.id;
      entity.type = row.type;
      entity.completed = row.completed;
      entity.extra = row.extra as Record<string, string>;
      entity.params = row.params as Record<string, string>;
      entity.creationTime = row.creationTime as string;
      entity.events = events;
    }

    return entity;
  }

  /**
   * Inserts multiple events into the database.
   *
   * This function attempts to insert each event in the provided array into the database.
   * It handles potential errors for each insertion individually and logs the results.
   *
   * @param events - An array of Event objects to be inserted into the database.
   * @param updateMethod - A string describing the method of update (e.g., "manual-pull", "auto-pull").
   *                       This is used for logging purposes.
   *
   * @returns A Promise that resolves to the number of successfully inserted events.
   *          If no events were inserted successfully, it returns undefined.
   *
   * @throws Will throw an Error if an event object is invalid (i.e., missing eventId).
   */
  async insertEvents(events: Event[], updateMethod: string): Promise<number | undefined> {
    let insertedNum = 0;
    for (const event of events) {
      // Validate input
      if (!event || !event.eventId) {
        throw new Error("Invalid event object: eventId is required");
      }

      logger.info(
          `${updateMethod}: Insert new event with ID ${event.eventId}`,
      );

      try {
        // SQL statement for inserting
        const result = await this.sql`
        INSERT INTO events (event_id, status, what_, when_, where_,
                            whom_, notes, operator_code, tracking_num, data_provider,
                            exception_code, exception_desc, notification_code, notification_desc, extra,
                            source_data)
        VALUES (${event.eventId},
                ${event.status},
                ${event.what ?? ""},
                ${event.when ?? ""},
                ${event.where ?? ""},
                ${event.whom ?? ""},
                ${event.notes ?? ""},
                ${event.operatorCode ?? ""},
                ${event.trackingNum ?? ""},
                ${event.dataProvider ?? ""},
                ${event.exceptionCode || null},
                ${event.exceptionDesc || null},
                ${event.notificationCode || null},
                ${event.notificationDesc || null},
                ${this.sql.json(ensureJSONSafe(event.extra ?? {}))},
                ${this.sql.json(ensureJSONSafe(event.sourceData ?? {}))}
               ) ON CONFLICT(event_id) DO NOTHING RETURNING event_id;
        `;

        if (result.count === 0) {
          // log the info if no event_id was inserted
          logger.info(`Event with ID ${event.eventId} could not be inserted.`);
        }
        insertedNum = insertedNum + result.count;
      } catch (err) {
        logger.error(`Failed to insert event with ID ${event.eventId}:`, err);
      }
    }
    return insertedNum;
  }

  /**
   * Deletes a single event from the database based on its event ID.
   *
   * @param eventID - The unique identifier of the event to be deleted.
   * @returns A Promise that resolves to:
   *          - The number of rows affected by the delete operation (typically 1 if successful).
   *          - undefined if no rows were affected or if the operation failed.
   * @throws Will throw an error if the database operation fails.
   */
  async deleteEvent(eventID: string): Promise<number | undefined> {
    // delete events
    const result = await this.sql`DELETE FROM events WHERE event_id = ${eventID}`;
    return result.count;
  }

  /**
   * Queries and retrieves all events associated with a specific tracking ID from the database.
   *
   * This function performs a SQL query to fetch all event details for a given tracking ID,
   * constructs Event objects from the retrieved data, and returns them as an array.
   *
   * @param trackingID - An object of type TrackingID containing the operator code and tracking number
   *                     used to identify the relevant events in the database.
   *
   * @returns A Promise that resolves to an array of Event objects. Each Event object contains
   *          detailed information about a specific event associated with the given tracking ID.
   *          If no events are found, an empty array is returned.
   */
  async queryEvents(trackingID: TrackingID): Promise<Event[]> {
    const events: Event[] = [];
    const rows = await this.sql`
        SELECT event_id,
               status,
               what_,
               whom_,
               when_,
               where_,
               notes,
               operator_code,
               tracking_num,
               data_provider,
               exception_code,
               exception_desc,
               notification_code,
               notification_desc,
               extra,
               source_data
        FROM events
        WHERE operator_code = ${trackingID.operator}
          AND tracking_num = ${trackingID.trackingNum}
        ORDER BY event_id ASC;
    `;

    for (const row of rows) {
      const event = new Event();
      event.eventId = row.event_id as string;
      event.status = row.status as number;
      event.what = row.what_ as string;
      event.whom = row.whom_ as string;
      event.when = row.when_ as string;
      event.where = row.where_ as string;
      event.notes = row.notes as string;
      event.operatorCode = row.operator_code as string;
      event.trackingNum = row.tracking_num as string;
      event.dataProvider = row.data_provider as string;
      event.exceptionCode = row.exception_code as number;
      event.exceptionDesc = row.exception_desc as string;
      event.notificationCode = row.notification_code as number;
      event.notificationDesc = row.notification_desc as string;
      event.extra = row.extra as Record<string, string>;
      event.sourceData = row.source_data as Record<string, string>;
      events.push(event);
    }

    return events;
  }

  /**
   * Retrieves all event IDs associated with a specific tracking ID from the database.
   *
   * This function queries the database to fetch all event IDs that match the given
   * tracking ID's operator code and tracking number.
   *
   * @param trackingID - An object of type TrackingID containing the operator code
   *                     and tracking number used to identify the relevant events
   *                     in the database.
   * @returns A Promise that resolves to an array of strings, where each string
   *          represents a unique event ID associated with the given tracking ID.
   *          If no matching events are found, an empty array is returned.
   */
  async queryEventIds(trackingID: TrackingID): Promise<string[]> {
    const eventIds: string[] = [];
    const rows = await this.sql`
        SELECT event_id
        FROM events
        WHERE operator_code = ${trackingID.operator}
          AND tracking_num = ${trackingID.trackingNum};
    `;

    for (const row of rows) {
      eventIds.push(row.event_id as string);
    }
    return eventIds;
  }

  /**
   * Checks if a given token is valid by querying the database.
   *
   * This function performs a database query to check if the provided token
   * exists in the 'tokens' table. It's typically used for authentication
   * or authorization purposes.
   *
   * @param token - The token string to be validated.
   * @returns A Promise that resolves to a boolean:
   *          - true if the token is found in the database (i.e., it's valid).
   *          - false if the token is not found in the database (i.e., it's invalid).
   */
  async isTokenValid(token: string): Promise<boolean> {
    const rows = await this.sql`
        SELECT id
        FROM tokens
        WHERE id = ${token};
    `;

    return rows.length == 1;
  }

  /**
   * Retrieves tracking numbers and their associated parameters for entities that are still in processing.
   *
   * This function queries the database for all entities that have not been completed (i.e., where 'completed' is false).
   * It returns a record where each key is a tracking number (the entity's ID) and the value is the entity's parameters.
   *
   * @returns A Promise that resolves to a Record where:
   *          - The keys are tracking numbers (strings) of in-processing entities
   *          - The values are the corresponding entity parameters (as unknown, but typically Record<string, string>)
   * @throws Will throw an error if the database query fails
   */
  async getInProcessingTrackingNums(): Promise<Record<string, unknown>> {
    const trackingNums: Record<string, unknown> = {};
    const rows = await this.sql`SELECT id, params FROM entities WHERE completed = false;`;

    for (const row of rows) {
      trackingNums[row.id as string] = row.params as Record<string, string>;
    }

    return trackingNums;
  }

}


