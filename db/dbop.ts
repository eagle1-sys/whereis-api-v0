/**
 * @file dbop.ts
 * @description The module encapsulates database interactions for:
 * - Object management (insert, update, query)
 * - Event tracking (insert, query)
 * - Status monitoring
 * - Tracking number management
 */

import postgres from "postgresjs";
import { Entity, Event, TrackingID } from "../main/model.ts";
import { logger } from "../tools/logger.ts";
import { JSONValue } from "../main/model.ts";

/**
 * Insert object and events into table
 * @param {ReturnType<typeof postgres>} sql - The PostgreSQL client instance
 * @param entity Entity object with events
 * @returns {Promise<number | undefined>} A promise that resolves to the number of affected rows on success, or undefined if the operation fails.
 */
export async function insertEntity(
  sql: ReturnType<typeof postgres>,
  entity: Entity,
): Promise<number | undefined> {
  try { // SQL statement for inserting
    const result = await sql`
        INSERT INTO entities (uuid, id, type, creation_time, completed, extra, params)
        VALUES (${entity.uuid},
                ${entity.id},
                ${entity.type},
                ${entity.getCreationTime()},
                ${entity.isCompleted()},
                ${sql.json(entity.extra)},
                ${sql.json(entity.params)}) `;

    if (result.count == 1 && entity.events != undefined) {
      for (const event of entity.events) {
        // raise exception if any error occurs during event insertion
        await insertEvent(sql, event);
      }
    }
  } catch (e) {
    console.log(e);
  }

  return 1;
}

/**
 * Updates an existing entity record and manages associated events in the database.
 * This function performs three main operations:
 * 1. Updates the entity's completion status if it's completed.
 * 2. Inserts new events associated with the entity.
 * 3. Removes events that are no longer associated with the entity.
 *
 * @param sql - The PostgreSQL client instance used for database operations.
 * @param entity - The Entity object containing updated information and events.
 * @param eventIdsNew - An array of event IDs that need to be inserted.
 * @param eventIdsToBeRemoved - An array of event IDs that need to be removed from the database.
 * @returns A Promise that resolves to 1 if the update was successful, or undefined if an error occurred.
 */
export async function updateEntity(
  sql: ReturnType<typeof postgres>,
  entity: Entity,
  eventIdsNew: string[],
  eventIdsToBeRemoved: string[],
): Promise<boolean> {
  // update the entity record
  try {
    // step 2: update the entity record ONLY when the entity is completed
    if (entity.isCompleted()) {
      await sql`
      update entities set completed = true where id = ${entity.id as string}
    `;
    }

    // step 2: insert new events
    if (eventIdsNew.length > 0) {
      const events: Event[] = entity.events.filter((event) =>
        eventIdsNew.includes(event.eventId)
      );
      for (const event of events) {
        logger.info(`Auto-pull: Insert event with id ${event.eventId}`);
        await insertEvent(sql, event);
      }
    }

    // step 3: remove events that are not in the updated entity
    if(eventIdsToBeRemoved.length>0) {
      for (const eventId of eventIdsToBeRemoved) {
        logger.info(`Auto-pull: Delete event with id ${eventId}`);
        await deleteEvent(sql, eventId);
      }
    }

    return true;
  } catch (e) {
    logger.error(`Error updating entity: ${e}`);
    return false;
  }
}

export async function deleteEntity(
  sql: ReturnType<typeof postgres>,
  trackingID: TrackingID,
): Promise<number | undefined> {
  // delete events
  const result1 = await sql`
      DELETE FROM events
      WHERE operator_code = ${trackingID.operator}
        AND tracking_num = ${trackingID.trackingNum}
  `;

  const result2 = await sql`
    DELETE
    FROM entities
    WHERE id = ${trackingID.toString()}
  `;
  return result1.count + result2.count;
}

/**
 * Insert one event data into table
 @param {ReturnType<typeof postgres>} sql - The PostgreSQL client instance
 * @param event Event object
 * @returns {Promise<number | undefined>} A promise that resolves to the number of affected rows on success, or undefined if the operation fails.
 */
async function insertEvent(
  sql: ReturnType<typeof postgres>,
  event: Event,
): Promise<string | undefined> {
  // Validate input
  if (!event || !event.eventId) {
    throw new Error("Invalid event object: eventId is required");
  }

  try {
    // Insert into DB table
    // SQL statement for inserting
    const result = await sql`
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
                ${sql.json(ensureJSONSafe(event.extra ?? {}))},
                ${sql.json(ensureJSONSafe(event.sourceData ?? {}))}
               ) ON CONFLICT(event_id) DO NOTHING RETURNING event_id;
    `;

    if (result.count === 1) {
      return result[0].event_id;
    }

    // log the info if no event_id was inserted
    logger.warn(`Insert event failed: ${event.eventId} `);
  } catch (err) {
    logger.error(`Error inserting event ${event.eventId}:`, err);
  }
  return undefined;
}

export async function deleteEvent(
  sql: ReturnType<typeof postgres>,
  eventID: string,
): Promise<number | undefined> {
  // delete events
  const result = await sql`
      DELETE FROM events
      WHERE event_id = ${eventID}
  `;
  return result.count;
}

export async function markEventAsDeleted(
  sql: ReturnType<typeof postgres>,
  eventID: string,
): Promise<number | undefined> {
  const fromIdx = eventID.indexOf("-");
  const uptoIdx = eventID.lastIndexOf("-");
  const trackingNum = eventID.substring(fromIdx + 1, uptoIdx) + "-delete";
  // mark the tracking_num as deleted
  const result = await sql`
      update events
      set tracking_num = ${trackingNum}
      where event_id = ${eventID}
  `;
  return result.count;
}

/**
 * Query entity from DB by trackingID
 @param {ReturnType<typeof postgres>} sql - The PostgreSQL client instance
 * @param trackingID
 * @return {Promise<Entity | undefined>} A promise that resolves to the entity object if found, or undefined.
 */
export async function queryEntity(
  sql: ReturnType<typeof postgres>,
  trackingID: TrackingID,
): Promise<Entity | undefined> {
  const rows = await sql`
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
  if (rows.length == 1) {
    entity = new Entity();
    const row = rows[0];
    entity.uuid = row.uuid;
    entity.id = row.id;
    entity.type = row.type;
    entity.completed = row.completed;
    entity.extra = row.extra as Record<string, string>;
    entity.params = row.params as Record<string, string>;
    entity.creationTime = row.creationTime as string;
  }

  if (entity != undefined) {
    // query events from database
    entity.events = await queryEvents(sql, trackingID);
  }
  return entity;
}

/**
 * Query events by trackingID
 @param {ReturnType<typeof postgres>} sql - The PostgreSQL client instance
 * @param trackingID
 * @returns {Promise<Event[]>} A promise that resolves to object event array
 */
async function queryEvents(
  sql: ReturnType<typeof postgres>,
  trackingID: TrackingID,
): Promise<Event[]> {
  const events: Event[] = [];
  const rows = await sql`
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
 * Query eventIDs by trackingID
 * @param {ReturnType<typeof postgres>} sql - The PostgreSQL client instance
 * @param trackingID
 * @returns {Promise<string[]>} A promise resolves to event id array
 */
export async function queryEventIds(
  sql: ReturnType<typeof postgres>,
  trackingID: TrackingID,
): Promise<string[]> {
  const eventIds: string[] = [];
  const rows = await sql`
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
 * Get in-procesing tracking numbers
 * @param {ReturnType<typeof postgres>} sql - The PostgreSQL client instance
 * @returns {Promise<Record<string, unknown>>} A promise resolves to JSON object
 */
export async function getInProcessingTrackingNums(
  sql: ReturnType<typeof postgres>,
): Promise<Record<string, unknown>> {
  const trackingNums: Record<string, unknown> = {};
  const rows = await sql`
        SELECT id, params
        FROM entities
        WHERE completed = false;
    `;

  for (const row of rows) {
    trackingNums[row.id as string] = row.params as Record<string, string>;
  }

  return trackingNums;
}

/**
 * Query token from DB
 * @param {ReturnType<typeof postgres>} sql - The PostgreSQL client instance
 * @param token
 * @return {Promise<boolean>} A promise that resolves to true if found, or false.
 */
export async function isTokenValid(
  sql: ReturnType<typeof postgres>,
  token: string,
): Promise<boolean> {
  const rows = await sql`
        SELECT id
        FROM tokens
        WHERE id = ${token};
    `;

  return rows.length == 1;
}

function ensureJSONSafe(obj: unknown): JSONValue {
  if (typeof obj === "object" && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, ensureJSONSafe(v)]),
    );
  }
  if (obj !== null && Array.isArray(obj)) {
    return obj.map(ensureJSONSafe);
  }
  if (
    typeof obj === "string" || typeof obj === "number" ||
    typeof obj === "boolean" || obj === null
  ) {
    return obj;
  }
  return String(obj);
}
