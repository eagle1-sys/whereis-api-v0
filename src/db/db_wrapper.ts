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

  /**
   * Checks the database connection health.
   * @returns Promise resolving to true if the database is accessible, false otherwise
   */
  ping(): Promise<boolean>;

  /**
   * Validates whether an API token exists and is active in the database.
   * @param token - The API token to validate
   * @returns Promise resolving to true if the token is valid, false otherwise
   */
  isTokenValid(token: string): Promise<boolean>;

  /**
   * Inserts a new API key and associates it with a user identifier.
   * @param apikey - The API key to insert (typically in format 'sk-...')
   * @param userId - The user identifier to associate with the API key
   * @returns Promise resolving to the number of rows inserted (0 if key already exists due to conflict, 1 if successfully inserted)
   */
  insertToken(apikey: string, userId: string): Promise<number>;

  /**
   * Inserts a new tracking entity into the database.
   * @param entity - The entity object containing tracking information and events
   * @returns Promise resolving to:
   *          - 1 if the entity and its events were successfully inserted
   *          - 0 if the entity has no events or the insertion failed
   */
  insertEntity(entity: Entity): Promise<number>;

  /**
   * Completely replaces an existing entity's data with new information.
   * This operation removes all existing events and replaces them with the new entity's events.
   * @param trackingId - The tracking identifier of the entity to refresh
   * @param entity - The new entity data to replace the existing data
   * @returns Promise resolving to:
   *          - 1 if the refresh operation succeeded (entity deleted and new data inserted)
   *          - 0 if the entity has no events or the operation failed
   */
  refreshEntity(trackingId: TrackingID, entity: Entity): Promise<number>;

  /**
   * Updates an existing entity by adding new events and removing specified events.
   * This method performs incremental updates without replacing the entire entity.
   * @param entity - The entity containing updated information
   * @param updateMethod - The method used to obtain the update (e.g., 'manual-pull', 'auto-pull')
   * @param eventIdsNew - Array of new event IDs to add to the entity
   * @param eventIdsToBeRemoved - Array of event IDs to remove from the entity
   * @returns Promise resolving to:
   *          - 1 if the update operation succeeded
   *          - 0 if the operation failed
   */
  updateEntity(entity: Entity, updateMethod: string, eventIdsNew: string[], eventIdsToBeRemoved: string[]): Promise<number>;

  /**
   * Retrieves all event IDs associated with a tracking entity.
   * @param trackingId - The tracking identifier to query
   * @returns Promise resolving to an array of event ID strings, or empty array if entity not found
   */
  queryEventIds(trackingId: TrackingID): Promise<string[]>;

  /**
   * Retrieves a complete tracking entity with all its events and metadata.
   * @param trackingId - The tracking identifier to query
   * @returns Promise resolving to the Entity object if found, or undefined if not found
   */
  queryEntity(trackingId: TrackingID): Promise<Entity | undefined>;

  /**
   * Retrieves all tracking numbers currently in processing status.
   * Used for monitoring and managing active shipments that require updates.
   * @returns Promise resolving to a record mapping tracking numbers to their associated parameters
   * @example
   * {
   *   "1234567890123": {},
   *   "SF1234567890123": {"phonenum": "1234567890"}
   * }
   */
  getInProcessingTrackingNums(): Promise<Record<string, Record<string, string>>>;

}