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
import { Entity, TrackingID } from "../main/model.ts";

export interface DatabaseWrapper {

  ping(): Promise<boolean>;

  insertToken(apikey: string, userId: string): Promise<boolean>;

  insertEntity(entity: Entity): Promise<number | undefined>;

  updateEntity(
    entity: Entity,
    eventIdsNew: string[],
    eventIdsToBeRemoved: string[],
  ): Promise<boolean>;

  refreshEntity(trackingId: TrackingID, entity: Entity): Promise<boolean>;

  queryEntity(trackingId: TrackingID): Promise<Entity | undefined>;

  queryEventIds(trackingId: TrackingID): Promise<string[]>;

  isTokenValid(token: string): Promise<boolean>;

  getInProcessingTrackingNums(): Promise<Record<string, Record<string, string>>>;

}
