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

export class SQLiteWrapper implements DatabaseWrapper {

  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Pings the database to check the connection status.
   *
   * @returns A Promise that resolves to true if the database connection is successful
   *          and the test query returns the expected result, false otherwise.
   */
  ping(): Promise<boolean> {
    return new Promise((resolve, _reject) => {
      const stmt = this.db.prepare('SELECT 1 as connection_test');
      try {
        const testResult = stmt.get() as { connection_test: number };
        resolve(testResult && testResult.connection_test === 1);
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
  async isTokenValid(token: string): Promise<boolean> {
    return await new Promise((resolve, _reject) => {
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
   * This function attempts to insert a new API key and userId into the tokens table.
   * If a token with the same id already exists, the insertion is ignored.
   *
   * @param apikey - The unique API key.
   * @param userId - The user identifier associated with the API key.
   *
   * @returns A Promise that resolves to the number of rows affected by the insert operation.
   *          Returns 1 if a new token was inserted, or 0 if the token already exists and was ignored.
   */
  insertToken(apikey: string, userId: string): Promise<number> {
    return new Promise((resolve, _reject) => {
      const stmt = this.db.prepare(
          `INSERT OR IGNORE
           INTO tokens (id, user_id)
           VALUES (?, ?)`,
      );
      try {
        stmt.run(apikey, userId);
        resolve(this.db.changes);
      } finally {
        stmt.finalize();
      }
    });
  }

  /**
   * Inserts a new entity into the database.
   *
   * @param entity - The Entity object to be inserted.
   * @returns A Promise that resolves to the number of changes made in the database, or undefined if no changes were made.
   */
  async insertEntity(entity: Entity): Promise<number> {
    const updateMethod = DataUpdateMethod.getDisplayText("manual-pull");
    if(entity.events === undefined || entity.events.length === 0) {
      logger.error(`Entity [${entity.id}] has no events`);
      return 0;
    }

    return await new Promise((resolve, _reject) => {
      const transaction = this.db.transaction(() => {
        // insert the entity record ONLY
        const changes = this.insertEntityRecord(this.db, entity);

        // insert the events if the entity is completed
        if (changes === 1) {
          this.insertEvents(this.db, entity.events, updateMethod);
        }
        return changes;
      });

      try {
        const changes = transaction();
        resolve(changes);
      } catch (_err) {
        resolve(0);
      }
    });
  }

  /**
   * Updates an existing entity in the database by modifying its completion status,
   * adding new events, and removing obsolete events.
   *
   * @param entity - The Entity object containing the updated data to be applied.
   * @param updateMethod - A string indicating the method of update (e.g., "manual-pull" or "auto-pull").
   * @param eventIdsNew - An array of event IDs representing new events to be inserted into the database.
   * @param eventIdsToBeRemoved - An array of event IDs representing events to be deleted from the database.
   * @returns A Promise that resolves to 1 if the update was successful, or 0 if an error occurred.
   */
  async updateEntity(entity: Entity, updateMethod: string, eventIdsNew: string[], eventIdsToBeRemoved: string[]): Promise<number> {
    let changed = 0;
    const updateMethodText = DataUpdateMethod.getDisplayText(updateMethod);

    return await new Promise((resolve, _reject) => {
      const transaction = this.db.transaction(async () => {
        // step 1: update the entity record ONLY when the entity is completed
        if (entity.isCompleted()) {
          const stmt = this.db.prepare(`UPDATE entities SET completed = 1 WHERE id = ?`);
          try {
            stmt.run(entity.id);
            changed = changed + this.db.changes;
          } finally {
            stmt.finalize();
          }
        }

        // step 2: insert new events
        if (eventIdsNew.length > 0) {
          const events: Event[] = (entity.events ?? []).filter((event) =>
              eventIdsNew.includes(event.eventId)
          );

          const inserted = await this.insertEvents(this.db, events, updateMethodText);
          changed = changed + (inserted?? 0);
        }

        // step 3: remove events that are not in the updated entity
        if (eventIdsToBeRemoved.length > 0) {
          const stmt = this.db.prepare(`DELETE FROM events WHERE event_id = ?`);
          try {
            for (const eventId of eventIdsToBeRemoved) {
              logger.info(`${updateMethod}: Delete exist event with ID ${eventId}`);
              stmt.run(eventId);
              changed = changed + this.db.changes;
            }
          } finally {
            stmt.finalize();
          }
        }
        return changed > 0 ? 1 : 0;
      });

      try {
        const updated = transaction();
        resolve(updated);
      } catch (_err) {
        resolve(0);
      }
    });
  }

  /**
   * Refreshes an entity in the database by deleting and reinserting it.
   *
   * @param trackingId - The TrackingID of the entity to be refreshed.
   * @param entity - The updated Entity object to be inserted.
   * @returns A Promise that resolves to 1 if the refresh was successful, or 0 if the
   *          operation failed (e.g., entity has no events or a database error occurred).
   */
  async refreshEntity(trackingId: TrackingID, entity: Entity): Promise<number> {
    const updateMethod = DataUpdateMethod.getDisplayText("manual-pull");
    if(entity.events === undefined || entity.events.length === 0) {
      logger.error(`Entity [${entity.id}] has no events`);
      return 0;
    }

    return await new Promise((resolve, _reject) => {
      const transaction = this.db.transaction(() => {
        this.deleteEntityAndEvents(this.db, trackingId);

        // insert the entity record ONLY
        const changes = this.insertEntityRecord(this.db, entity);
        // insert the events if the entity is completed
        if (changes === 1) {
          this.insertEvents(this.db, entity.events, updateMethod);
        }
        return changes;
      });

      try {
        const changes = transaction();
        resolve(changes);
      } catch {
        resolve(0);
      }
    });
  }

  /**
   * Queries the database for an entity with the given tracking ID.
   *
   * @param trackingId - The TrackingID of the entity to be queried.
   * @returns A Promise that resolves to the Entity object if found, or undefined if not found.
   */
  async queryEntity(trackingId: TrackingID): Promise<Entity | undefined> {
    const entity = this.queryEntityRecord(trackingId);

    if (entity !== undefined) {
      // Query events for this entity
      entity.events = await this.queryEvents(trackingId);
      if (entity.events.length === 0) {
        return undefined;
      }
    }

    return entity;
  }

  /**
   * Queries the database for event IDs associated with a given tracking ID.
   *
   * @param trackingId - The TrackingID used to query associated event IDs.
   * @returns A Promise that resolves to an array of event ID strings.
   */
  async queryEventIds(trackingId: TrackingID): Promise<string[]> {
    return await new Promise((resolve, _reject) => {
      const stmt = this.db.prepare(`
        SELECT event_id
        FROM events
        WHERE operator_code = ?
          AND tracking_num = ?
      `);

      try {
        const rows = stmt.all(trackingId.operator, trackingId.trackingNum);
        const eventIds = rows.map((row) => row.event_id as string);
        resolve(eventIds);
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
  async getInProcessingTrackingNums(): Promise<Record<string, Record<string, string>>> {
    return await new Promise((resolve, _reject) => {
      const trackingNums: Record<string, Record<string, string>> = {};
      const stmt = this.db.prepare(`SELECT id, params FROM entities WHERE completed = 0 AND use_pull= 1`);
      try {
        const rows = stmt.all();
        for (const row of rows) {
          trackingNums[row.id as string] = JSON.parse(row.params as string) as Record<string, string>;
        }
      } finally {
        stmt.finalize();
      }

      resolve(trackingNums);
    });
  }

  /**
   * Inserts a single entity record into the database.
   *
   * @param db
   * @param entity - The Entity object to be inserted.
   * @returns The number of database rows changed by the insert operation.
   */
  private insertEntityRecord(db: Database, entity: Entity): number {
    const insertEntityStmt = db.prepare(
        `INSERT INTO entities (uuid, id, type, use_pull, creation_time, completed, additional, params)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      insertEntityStmt.run(
          entity.uuid,
          entity.id,
          entity.type,
          entity.usePull,
          entity.getCreationTime(),
          entity.isCompleted() ? 1 : 0,
          JSON.stringify(entity.additional ?? {}),
          JSON.stringify(entity.params ?? {}),
      );
    } finally {
      insertEntityStmt.finalize();
    }
    return db.changes;
  }

  /**
   * Inserts multiple events into the database within a transaction.
   *
   * This method performs a batch insert of event records into the events table.
   * All insertions are wrapped in a database transaction to ensure atomicity.
   * If any event fails validation (missing eventId), an error is thrown and the
   * transaction is rolled back. Individual insert failures are logged but do not
   * stop the transaction.
   *
   * @param db - The SQLite Database instance to execute the insert operations on.
   * @param events - An array of Event objects to be inserted into the database.
   * @param updateMethod - A string indicating the method of update (e.g., "manual-pull" or "auto-pull"),
   *                       used for logging purposes to track the source of the data update.
   * @returns The total number of rows successfully inserted into the database. Returns 0 if the
   *          transaction fails or if no events were successfully inserted.
   */
  private insertEvents(db: Database, events: Event[], updateMethod:string): number {
    const transaction = db.transaction(() => {
      let changes = 0;
      const insertEventStmt = db.prepare(`
        INSERT INTO events (event_id, status, what_, when_, where_,
                            whom_, notes, operator_code, tracking_num, data_provider,
                            exception_code, exception_desc, notification_code, notification_desc, additional,
                            source_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      try {
        for (const event of events) {
          // Validate input
          if (!event || !event.eventId) {
            throw new Error("Invalid event object: eventId is required");
          }

          logger.info(`${updateMethod}: Insert new event with ID ${event.eventId}`);

          try {
            insertEventStmt.run(
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
                JSON.stringify(event.additional ?? {}),
                JSON.stringify(event.sourceData ?? {}),
            );

            const rowsAffected = db.changes;
            changes = changes + rowsAffected;
            if (rowsAffected !== 1) {
              // log the info if no event_id was inserted
              logger.info(`Event with ID ${event.eventId} could not be inserted. `);
            }
          } catch (err) {
            logger.error(`Failed to insert event with ID ${event.eventId}:`, err);
          }
        }
      } finally {
        insertEventStmt.finalize();
      }

      return changes;
    });

    try {
      return transaction();
    } catch (_err) {
      return 0;
    }
  }

  /**
   * Deletes an entity and its associated events from the database.
   *
   * @param db
   * @param trackingId - The TrackingID of the entity to be deleted.
   * @returns The number of rows affected by the delete operations. Returns a value
   *          greater than 0 if entity were successfully deleted, or 0 if no matching
   *          entity were found.
   */
  private deleteEntityAndEvents(db: Database, trackingId: TrackingID): number {
    const deleteEvents = db.prepare(`DELETE
                                       FROM events
                                       WHERE operator_code = ?
                                         AND tracking_num = ?`);
    const deleteEntity = db.prepare(`DELETE
                                       FROM entities
                                       WHERE id = ?`);
    try {
      deleteEvents.run(trackingId.operator, trackingId.trackingNum);
      deleteEntity.run(trackingId.toString());
    } finally {
      deleteEvents.finalize();
      deleteEntity.finalize();
    }
    return db.changes;
  }

  /**
   * Queries the database for a single entity record based on its tracking ID.
   *
   * @param trackingId - The TrackingID of the entity to be queried.
   * @returns An Entity object if found, otherwise undefined.
   */
  private queryEntityRecord(trackingId: TrackingID): Entity | undefined {
    let entity: Entity | undefined;
    const stmt = this.db.prepare(`
      SELECT uuid, id, type, use_pull, completed, additional, params, creation_time
      FROM entities
      WHERE id = ?
    `);

    try {
      const row = stmt.get(trackingId.toString()) as {
        uuid: string;
        id: string;
        type: string;
        use_pull: number;
        completed: number;
        additional: string;
        params: string;
        creation_time: string;
      } | undefined;

      if (row) {
        entity = new Entity();
        entity.uuid = row.uuid;
        entity.id = row.id;
        entity.type = row.type;
        entity.usePull = Boolean(row.use_pull);
        entity.completed = Boolean(row.completed);
        entity.additional = JSON.parse(row.additional);
        entity.params = JSON.parse(row.params);
        entity.creationTime = row.creation_time;
      }
    } finally {
      stmt.finalize();
    }
    return entity;
  }

  /**
   * Queries the database for events associated with a given tracking ID.
   *
   * @param trackingId - The TrackingID used to query associated events.
   * @returns A Promise that resolves to an array of Event objects.
   */
  private async queryEvents(trackingId: TrackingID): Promise<Event[]> {
    return await new Promise((resolve, _reject) => {
      const stmt = this.db.prepare(`
        SELECT event_id, status, what_, whom_, when_, where_, notes,
               operator_code, tracking_num, data_provider, exception_code,
               exception_desc, notification_code, notification_desc, additional, source_data
        FROM events
        WHERE operator_code = ? AND tracking_num = ?
        ORDER BY event_id ASC
      `);

      try {
        const rows = stmt.all(trackingId.operator, trackingId.trackingNum);
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
          event.additional = row.additional ? JSON.parse(row.additional) : {};
          event.sourceData = row.source_data ? JSON.parse(row.source_data) : {};
          return event;
        });

        resolve(events);
      } finally {
        stmt.finalize();
      }
    });
  }

}