/**
 * @file db_sqlite.ts
 * @description This module provides SQLite database operations for the Whereis API.
 * It includes functions for initializing the database, managing tokens, and a
 * SQLiteWrapper class that implements the DatabaseWrapper interface.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { Database } from "sqlite";

import { logger } from "../tools/logger.ts";
import { DatabaseWrapper } from "./db_wrapper.ts";
import { DataUpdateMethod, Entity, Event, TrackingID } from "../main/model.ts";

/**
 * Initializes the SQLite database by creating necessary tables and indexes.
 *
 * This function sets up the database schema for the Whereis API, creating tables
 * for entities, events, and tokens if they don't already exist. It also creates
 * indexes to optimize query performance.
 *
 * @param db - The SQLite Database instance to initialize.
 * @returns void - This function doesn't return a value.
 */
export function initDatabase(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
        uuid          TEXT NOT NULL PRIMARY KEY,
        id            TEXT NOT NULL,
        type          TEXT,
        extra         TEXT,
        completed     INTEGER,
        params        TEXT,
        creation_time TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_entities_id ON entities (id);

    CREATE TABLE IF NOT EXISTS events (
        event_id          TEXT NOT NULL PRIMARY KEY,
        status            INTEGER,
        what_             TEXT,
        whom_             TEXT,
        when_             TEXT,
        where_            TEXT,
        notes             TEXT,
        operator_code     TEXT,
        tracking_num      TEXT,
        data_provider     TEXT,
        exception_code    INTEGER,
        exception_desc    TEXT,
        notification_code INTEGER,
        notification_desc TEXT,
        extra             TEXT,
        source_data       TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_operator ON events (operator_code);

    CREATE INDEX IF NOT EXISTS idx_events_tracking_num ON events (tracking_num);

    CREATE TABLE IF NOT EXISTS tokens (
        id      TEXT NOT NULL PRIMARY KEY,
        user_id TEXT
    );
  `);
}

/**
 * Inserts a new token into the database or ignores if it already exists.
 *
 * This function attempts to insert a new token with the given id and userId into the tokens table.
 * If a token with the same id already exists, the insertion is ignored.
 *
 * @param db - The SQLite Database instance to perform the insertion on.
 * @param id - The unique identifier for the token.
 * @param userId - The user identifier associated with the token.
 *
 * @returns void - This function doesn't return a value, but logs the result of the operation.
 */
export function insertToken(db: Database, id: string, userId: string): void {
  db.exec(`
    INSERT OR IGNORE INTO tokens (id, user_id)
    VALUES ('${id}', '${userId}')
  `);

  if (db.changes > 0) {
    logger.info(`Token inserted successfully: id=${id}, user_id=${userId}`);
  } else {
    logger.info(`Token with id=${id} already exists, no changes made.`);
  }
}

export class SQLiteWrapper implements DatabaseWrapper {

  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Pings the database to check the connection status.
   *
   * @returns A Promise that resolves to 1 if the connection is successful, 0 otherwise.
   */
   ping(): Promise<number> {
    return new Promise((resolve, _reject) => {
      const testResult = this.db.prepare('SELECT 1 as connection_test').get() as { connection_test: number };
      if (testResult && testResult.connection_test === 1) {
        resolve(1);
      } else {
        resolve(0);
      }
    });
  }

  /**
   * Inserts a new entity into the database.
   *
   * @param entity - The Entity object to be inserted.
   * @returns A Promise that resolves to the number of changes made in the database, or undefined if no changes were made.
   */
  insertEntity(entity: Entity): Promise<number | undefined> {
    const updateMethod = DataUpdateMethod.getDisplayText("manual-pull");
    return new Promise((resolve, _reject) => {
      this.db.exec(`
        INSERT INTO entities (uuid, id, type, creation_time, completed, extra, params)
        VALUES (
          '${entity.uuid}',
          '${entity.id}',
          '${entity.type}',
          '${entity.getCreationTime()}',
          ${entity.isCompleted() ? 1 : 0},
          '${JSON.stringify(entity.extra)}',
          '${JSON.stringify(entity.params)}'
        )
      `);

      const changes = this.db.changes;
      if (changes === 1 && entity.events !== undefined) {
        this.insertEvents(entity.events, updateMethod);
      }

      resolve(changes);
    });
  }

  /**
   * Updates an existing entity in the database and manages its associated events.
   *
   * @param entity - The Entity object with updated information.
   * @param eventIdsNew - An array of new event IDs to be inserted.
   * @param eventIdsToBeRemoved - An array of event IDs to be removed.
   * @returns A Promise that resolves to true if the update was successful.
   */
  updateEntity(entity: Entity, eventIdsNew: string[],eventIdsToBeRemoved: string[]): Promise<boolean> {
    return new Promise((resolve, _reject) => {
      const updateMethod = DataUpdateMethod.getDisplayText("auto-pull");
      // step 1: update the entity record ONLY when the entity is completed
      if (entity.isCompleted()) {
        this.db.exec(`UPDATE entities SET completed = 1 WHERE id = '${entity.id}'`);
      }

      // step 2: insert new events
      if (eventIdsNew.length > 0) {
        const events: Event[] = entity.events.filter((event) =>
            eventIdsNew.includes(event.eventId)
        );

        this.insertEvents(events, updateMethod);
      }

      // step 3: remove events that are not in the updated entity
      if (eventIdsToBeRemoved.length > 0) {
        for (const eventId of eventIdsToBeRemoved) {
          logger.info(`${updateMethod}: Delete exist event with ID ${eventId}`);
          this.deleteEvent(eventId);
        }
      }

      resolve(true) ;
    });
  }

  /**
   * Deletes an entity and its associated events from the database.
   *
   * @param trackingID - The TrackingID of the entity to be deleted.
   * @returns A Promise that resolves to the total number of changes made in the database, or undefined if no changes were made.
   */
  deleteEntity(trackingID: TrackingID): Promise<number | undefined> {
    return new Promise((resolve, _reject) => {
      let totalChanges = 0;

      // Delete events
      this.db.exec(`
      DELETE FROM events
      WHERE operator_code = '${trackingID.operator}'
        AND tracking_num = '${trackingID.trackingNum}'
    `);
      totalChanges += this.db.changes;

      // Delete entity
      this.db.exec(`
      DELETE FROM entities
      WHERE id = '${trackingID.toString()}'
    `);
      totalChanges += this.db.changes;

      resolve(totalChanges) ;
    });
  }

  /**
   * Refreshes an entity in the database by deleting and reinserting it.
   *
   * @param trackingId - The TrackingID of the entity to be refreshed.
   * @param entity - The updated Entity object to be inserted.
   * @returns A Promise that resolves to true if the refresh was successful.
   */
  refreshEntity(trackingId: TrackingID, entity: Entity): Promise<boolean> {
    return new Promise((resolve, _reject) => {
      this.db.transaction(() => {
        // Delete and insert the entity to ensure the latest data
        this.deleteEntity(trackingId).then(()=>{
          this.insertEntity(entity);
        });
      })();

      resolve(true);
    });
  }

  /**
   * Queries the database for an entity with the given tracking ID.
   *
   * @param trackingID - The TrackingID of the entity to be queried.
   * @returns A Promise that resolves to the Entity object if found, or undefined if not found.
   */
  async queryEntity(trackingID: TrackingID): Promise<Entity | undefined> {
    let entity;
    const stmt = this.db.prepare(`
    SELECT uuid, id, type, completed, extra, params, creation_time
    FROM entities
    WHERE id = ?
  `);

    try {
      const row = stmt.get(trackingID.toString()) as {
        uuid: string;
        id: string;
        type: string;
        completed: number;
        extra: string;
        params: string;
        creation_time: string;
      } | undefined;

      if (row) {
        const entity = new Entity();
        entity.uuid = row.uuid;
        entity.id = row.id;
        entity.type = row.type;
        entity.completed = Boolean(row.completed);
        entity.extra = JSON.parse(row.extra);
        entity.params = JSON.parse(row.params);
        entity.creationTime = row.creation_time;

        // Query events for this entity
        const events = await this.queryEvents(trackingID);

        if (events.length === 0) {
          logger.info(
              `Query-Entity: Event record not found for ID ${trackingID.toString()}`,
          );
          return undefined;
        }
        entity.events = events;
      }
    } finally {
      stmt.finalize();
    }
    return new Promise( (resolve, _reject) => {
      resolve(entity) ;
    });
  }

  /**
   * Inserts multiple events into the database.
   *
   * @param events - An array of Event objects to be inserted.
   * @param updateMethod - A string indicating the method of update (e.g., "manual-pull" or "auto-pull").
   * @returns A Promise that resolves to the number of changes made in the database, or undefined if no changes were made.
   */
  insertEvents(events: Event[], updateMethod:string): Promise<number | undefined> {
    return new Promise((resolve, _reject) => {
      let changes = 0;
      const insertEventStmt = this.db.prepare(`
        INSERT INTO events (event_id, status, what_, when_, where_,
                            whom_, notes, operator_code, tracking_num, data_provider,
                            exception_code, exception_desc, notification_code, notification_desc, extra,
                            source_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const event of events) {
        // Validate input
        if (!event || !event.eventId) {
          throw new Error("Invalid event object: eventId is required");
        }

        logger.info(
            `${updateMethod}: Insert new event with ID ${event.eventId}`,
        );

        try {
          const result = insertEventStmt.run(
              event.eventId,
              event.status,
              event.what ?? "",
              event.when ?? "",
              event.where ?? "",
              event.whom ?? "",
              event.notes ?? "",
              event.operatorCode ?? "",
              event.trackingNum ?? "",
              event.dataProvider ?? "",
              event.exceptionCode || null,
              event.exceptionDesc || null,
              event.notificationCode || null,
              event.notificationDesc || null,
              JSON.stringify(event.extra ?? {}),
              JSON.stringify(event.sourceData ?? {}),
          );

          changes = changes + result;
          if (result !== 1) {
            // log the info if no event_id was inserted
            logger.info(`Event with ID ${event.eventId} could not be inserted. `);
          }
        } catch (err) {
          logger.error(`Failed to insert event with ID ${event.eventId}:`, err);
        }
      }
      resolve (changes);
    });
  }

  /**
   * Deletes an event from the database.
   *
   * @param eventID - The ID of the event to be deleted.
   * @returns A Promise that resolves to the number of changes made in the database, or undefined if no changes were made.
   */
  deleteEvent(eventID: string): Promise<number | undefined> {
    return new Promise((resolve, _reject) => {
      const result = this.db.exec(`DELETE FROM events WHERE event_id = ?`,[eventID]);
      resolve(result);
    });
  }

  /**
   * Queries the database for events associated with a given tracking ID.
   *
   * @param trackingID - The TrackingID used to query associated events.
   * @returns A Promise that resolves to an array of Event objects.
   */
  queryEvents(trackingID: TrackingID): Promise<Event[]> {
    return new Promise((resolve, _reject) => {
      const stmt = this.db.prepare(`
    SELECT event_id, status, what_, whom_, when_, where_, notes,
           operator_code, tracking_num, data_provider, exception_code,
           exception_desc, notification_code, notification_desc, extra, source_data
    FROM events
    WHERE operator_code = ? AND tracking_num = ?
    ORDER BY event_id ASC
  `);
      try {
        const rows = stmt.all(trackingID.operator, trackingID.trackingNum);
        const events = rows.map((row) => {
          const event = new Event();
          event.eventId = row.event_id;
          event.status = row.status;
          event.what = row.what_;
          event.whom = row.whom_;
          event.when = row.when_;
          event.where = row.where_;
          event.notes = row.notes;
          event.operatorCode = row.operator_code;
          event.trackingNum = row.tracking_num;
          event.dataProvider = row.data_provider;
          event.exceptionCode = row.exception_code;
          event.exceptionDesc = row.exception_desc;
          event.notificationCode = row.notification_code;
          event.notificationDesc = row.notification_desc;
          event.extra = JSON.parse(row.extra);
          event.sourceData = JSON.parse(row.source_data);
          return event;
        });

        resolve(events);
      } finally {
        stmt.finalize();
      }
    });
  }

  /**
   * Queries the database for event IDs associated with a given tracking ID.
   *
   * @param trackingID - The TrackingID used to query associated event IDs.
   * @returns A Promise that resolves to an array of event ID strings.
   */
  queryEventIds(trackingID: TrackingID): Promise<string[]> {
    return new Promise((resolve, _reject) => {
      const stmt = this.db.prepare(`
    SELECT event_id
    FROM events
    WHERE operator_code = ? AND tracking_num = ?
  `);

      try {
        const rows = stmt.all(trackingID.operator, trackingID.trackingNum);
        const eventIds = rows.map((row) => row.event_id as string);
        resolve(eventIds);
      } finally {
        stmt.finalize();
      }
    });
  }

  /**
   * Checks if a given token is valid by querying the database.
   *
   * @param token - The token string to be validated.
   * @returns A Promise that resolves to true if the token is valid, false otherwise.
   */
  isTokenValid(token: string): Promise<boolean> {
    return new Promise((resolve, _reject) => {
      const stmt = this.db.prepare(`SELECT id FROM tokens WHERE id = ?`);
      try {
        const row = stmt.get(token);
        resolve(row !== undefined) ;
      } finally {
        stmt.finalize();
      }
    });
  }

  /**
   * Retrieves tracking numbers and their associated parameters for entities that are still in processing.
   *
   * @returns A Promise that resolves to a Record object where keys are tracking numbers and values are their associated parameters.
   */
  getInProcessingTrackingNums(): Promise<Record<string, unknown>> {
    return new Promise((resolve, _reject) => {
      const trackingNums: Record<string, unknown> = {};
      const stmt = this.db.prepare(`SELECT id, params FROM entities WHERE completed = 0`);
      try {
        const rows = stmt.all();
        for (const row of rows) {
          trackingNums[row.id as string] = JSON.parse(row.params as string);
        }
      } finally {
        stmt.finalize();
      }

      resolve(trackingNums) ;
    });
  }

}