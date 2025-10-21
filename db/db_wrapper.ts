/**
 * @file db_wrapper.ts
 * @description This file defines the DatabaseWrapper interface, which serves as a
 * contract for database operations in the Whereis API.
 *
 * The DatabaseWrapper interface abstracts the database operations, allowing for
 * different database implementations (e.g., SQLite, PostgreSQL) to be used
 * interchangeably within the application.
 *
 *  @copyright (c) 2025, the Eagle1 authors
 *  @license BSD 3-Clause License
 */
import { Entity, Event, TrackingID } from "../main/model.ts";

export interface DatabaseWrapper {

  ping(): Promise<number>;

  insertEntity(entity: Entity): Promise<number | undefined>;

  updateEntity(
    entity: Entity,
    eventIdsNew: string[],
    eventIdsToBeRemoved: string[],
  ): Promise<boolean>;

  deleteEntity(trackingID: TrackingID): Promise<number | undefined>;

  refreshEntity(trackingId: TrackingID, entity: Entity): Promise<boolean>;

  queryEntity(trackingID: TrackingID): Promise<Entity | undefined>;

  insertEvents(
    events: Event[],
    updateMethod: string,
  ): Promise<number | undefined>;

  deleteEvent(eventID: string): Promise<number | undefined>;

  queryEvents(trackingID: TrackingID): Promise<Event[]>;

  queryEventIds(trackingID: TrackingID): Promise<string[]>;

  isTokenValid(token: string): Promise<boolean>;

  getInProcessingTrackingNums(): Promise<Record<string, unknown>>;

}
