/**
 * @file dbop.ts
 * @description The module encapsulates database interactions for:
 * - Object management (insert, update, query)
 * - Event tracking (insert, query)
 * - Status monitoring
 * - Tracking number management
 */

import { PoolClient } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { Entity, Event, TrackingID } from "../main/model.ts";

/**
 * Insert object and events into table
 * @param client PoolClient
 * @param entity Entity object with events
 * @returns {Promise<number | undefined>} A promise that resolves to the number of affected rows on success, or undefined if the operation fails.
 */
export async function insertEntity(
  client: PoolClient,
  entity: Entity,
): Promise<number | undefined> {
  // SQL statement for inserting
  const insertQuery = `
        INSERT INTO entities (uuid, id, type, creation_time, completed, extra, params)
        VALUES ($1, $2, $3, $4, $5, $6, $7);
    `;

  // The data to be inserted
  const values = [
    entity.uuid,
    entity.id,
    entity.type,
    entity.getCreationTime(),
    entity.isCompleted(),
    entity.extra,
    entity.params,
  ];

  // Insert into DB table
  const result = await client.queryObject(insertQuery, values);

  if (result.rowCount == 1 && entity.events != undefined) {
    for (const event of entity.events) {
      // raise exception if any error occurs during event insertion
      await insertEvent(client, event);
    }
  }

  return result?.rowCount;
}

/**
 * Update existing entity record & append new event data to event table
 * @param client - PoolClient
 * @param entity - Entity object with updated event(s)
 * @param eventIds - Existing eventIDs
 * @returns {Promise<number | undefined>} A promise that resolves to the number of affected rows on success, or undefined if the operation fails.
 */
export async function updateEntity(
  client: PoolClient,
  entity: Entity,
  eventIds: string[],
): Promise<number | undefined> {
  // SQL statement for updating
  const updateQuery = `
        UPDATE entities SET completed=$1 WHERE id=$2
        `;
  // update the entity record
  const result = await client.queryObject(updateQuery, [
    entity.isCompleted(),
    entity.id,
  ]);

  if (result.rowCount == 1) {
    const events: Event[] = entity.events ?? [];
    for (const event of events) {
      if (
        event.eventId !== undefined && eventIds.includes(event.eventId)
      ) continue;
      await insertEvent(client, event);
    }
  }
  return result?.rowCount;
}

export async function deleteEntity(
  client: PoolClient,
  trackingID: TrackingID,
): Promise<number | undefined> {
  // delete events
  const deleteEvents = `
        DELETE FROM events WHERE operator_code=$1 AND tracking_num=$2
        `;
  const result1 = await client.queryObject(deleteEvents, [
    trackingID.operator,
    trackingID.trackingNum,
  ]);

  const deleteEntity = `
      DELETE
      FROM entities
      WHERE id = $1
  `;
  const result2 = await client.queryObject(deleteEntity, [
    trackingID.toString(),
  ]);

  return result1?.rowCount as number + (result2?.rowCount as number);
}

/**
 * Insert one event data into table
 * @param client PoolClient
 * @param event Event object
 * @returns {Promise<number | undefined>} A promise that resolves to the number of affected rows on success, or undefined if the operation fails.
 */
async function insertEvent(
  client: PoolClient,
  event: Event,
): Promise<number | undefined> {
  // SQL statement for inserting
  const insertQuery = `
        INSERT INTO events (
            event_id, tracking_num, status, what, when_, where_, whom,
            exception_code, exception_desc, notification_code, notification_desc,
            notes, extra, source_data, data_provider,operator_code
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        );
        `;

  // The data to be inserted
  const values = [
    event.eventId,
    event.trackingNum,
    event.status,
    event.what,
    event.when,
    event.where,
    event.whom,
    event.exceptionCode,
    event.exceptionDesc,
    event.notificationCode,
    event.notificationDesc,
    event.notes,
    event.extra,
    event.sourceData,
    event.dataProvider,
    event.operatorCode,
  ];

  // Insert into DB table
  const result = await client.queryObject(insertQuery, values);

  return result?.rowCount;
}

/**
 * Query entity from DB by trackingID
 * @param client PoolClient
 * @param trackingID
 * @return {Promise<Entity | undefined>} A promise that resolves to the entity object if found, or undefined.
 */
export async function queryEntity(
  client: PoolClient,
  trackingID: TrackingID,
): Promise<Entity | undefined> {
  const result = await client.queryArray`
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
  if (result.rows.length == 1) {
    entity = new Entity();
    const row = result.rows[0];
    entity.uuid = row[0] as string;
    entity.id = row[1] as string;
    entity.type = row[2] as string;
    entity.completed = row[3] as boolean;
    entity.extra = row[4] as Record<string, string>;
    entity.params = row[5] as Record<string, string>;
    entity.creationTime = row[6] as string;
  }

  if (entity != undefined) {
    // query events from database
    entity.events = await queryEvents(client, trackingID);
  }
  return entity;
}

/**
 * Query status by trackingID
 * @param client
 * @param trackingID
 * @returns {Promise<Record<string, unknown> | undefined>} A promise that resolves to JSON object if found, or undefined.
 */
export async function queryStatus(
  client: PoolClient,
  trackingID: TrackingID,
): Promise<Record<string, unknown> | undefined> {
  const result = await client.queryArray`
        SELECT status,
               what,
               exception_code,
               exception_desc
        FROM events
        WHERE operator_code = ${trackingID.operator}
          AND tracking_num = ${trackingID.trackingNum}
        ORDER BY when_ DESC LIMIT 1;
    `;

  if (result.rows.length == 1) {
    const row = result.rows[0];
    return {
      id: trackingID.toString(),
      status: row[0] as number,
      what: row[1] as string,
      ...(row[2] != null &&
        { exceptionCode: row[2] as string }),
      ...(row[3] != null &&
        { exceptionDesc: row[3] as string }),
    };
  }

  return undefined;
}

/**
 * Query events by trackingID
 * @param client
 * @param trackingID
 * @returns {Promise<Event[]>} A promise that resolves to object event array
 */
async function queryEvents(
  client: PoolClient,
  trackingID: TrackingID,
): Promise<Event[]> {
  const events: Event[] = [];
  const result = await client.queryArray`
        SELECT event_id,
               operator_code,
               tracking_num,
               status,
               what,
               when_,
               where_,
               whom,
               exception_code,
               exception_desc,
               notification_code,
               notification_desc,
               notes,
               extra,
               source_data,
               data_provider
        FROM events
        WHERE operator_code = ${trackingID.operator}
          AND tracking_num = ${trackingID.trackingNum};
    `;

  for (const row of result.rows) {
    const event = new Event();
    event.eventId = row[0] as string;
    event.operatorCode = row[1] as string;
    event.trackingNum = row[2] as string;
    event.status = row[3] as number;
    event.what = row[4] as string;
    event.when = row[5] as string;
    event.where = row[6] as string;
    event.whom = row[7] as string;
    event.exceptionCode = row[8] as number;
    event.exceptionDesc = row[9] as string;
    event.notificationCode = row[10] as number;
    event.notificationDesc = row[11] as string;
    event.notes = row[12] as string;
    event.extra = row[13] as Record<string, string>;
    event.sourceData = row[14] as Record<string, string>;
    event.dataProvider = row[15] as string;
    events.push(event);
  }

  return events;
}

/**
 * Query eventIDs by trackingID
 * @param client
 * @param trackingID
 * @returns {Promise<string[]>} A promise resolves to event id array
 */
export async function queryEventIds(
  client: PoolClient,
  trackingID: TrackingID,
): Promise<string[]> {
  const eventIds: string[] = [];
  const result = await client.queryArray`
        SELECT event_id
        FROM events
        WHERE operator_code = ${trackingID.operator}
          AND tracking_num = ${trackingID.trackingNum};
    `;

  for (const row of result.rows) {
    eventIds.push(row[0] as string);
  }
  return eventIds;
}

/**
 * Get in-procesing tracking numbers
 * @param client
 * @returns {Promise<Record<string, unknown>>} A promise resolves to JSON object
 */
export async function getInProcessingTrackingNums(
  client: PoolClient,
): Promise<Record<string, unknown>> {
  const trackingNums: Record<string, unknown> = {};
  const result = await client.queryArray`
        SELECT id, params
        FROM entities
        WHERE completed = false;
    `;

  for (const row of result.rows) {
    trackingNums[row[0] as string] = row[1];
  }

  return trackingNums;
}

/**
 * Query token from DB
 * @param client PoolClient
 * @param token
 * @return {Promise<boolean>} A promise that resolves to true if found, or false.
 */
export async function isTokenValid(
  client: PoolClient,
  token: string,
): Promise<boolean> {
  const result = await client.queryArray`
        SELECT id
        FROM tokens
        WHERE id = ${token};
    `;

  return result.rows.length == 1;
}
