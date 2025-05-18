/**
 * @file schedule.ts
 * @description Scheduler for synchronizing tracking routes with external data.
 * This module sets up a cron job to periodically fetch in-process tracking numbers,
 * query their latest status, and update the database accordingly. It handles
 * database transactions and error logging to ensure data consistency.
 */
import { connect } from "../db/dbutil.ts";
import {
  getInProcessingTrackingNums,
  queryEventIds,
  updateEntity,
} from "../db/dbop.ts";
import { logger } from "../tools/logger.ts";
import { requestWhereIs } from "./gateway.ts";
import { Entity, TrackingID } from "./model.ts";

/**
 * Synchronizes tracking routes by fetching in-process tracking numbers,
 * querying their status, and updating the database if new events are found.
 * Handles database transactions and ensures proper rollback on errors.
 *
 * @async
 * @throws {Error} If an error occurs during database operations or external requests.
 */
export async function syncRoutes() {
  let client;
  let inProcessTrackingNums: Record<string, unknown>;
  try {
    client = await connect();
    inProcessTrackingNums = await getInProcessingTrackingNums(client);

    client.queryObject("BEGIN");
    // for (const inProcessTrackingNum of inProcessTrackingNums) {
    for (const [id, params] of Object.entries(inProcessTrackingNums)) {
      const trackingID = TrackingID.parse(id);
      logger.info(
        `Auto-pull: Init operation for tracking ID ${trackingID.toString()}`,
      );

      const entity: Entity | undefined = await requestWhereIs(
        trackingID,
        params as Record<string, string>,
        "auto-pull",
      );
      if (entity === undefined) continue;

      const eventIds: string[] = await queryEventIds(
        client,
        trackingID,
      );

      if (entity instanceof Entity && entity.isRevised(eventIds)) {
        logger.info(`Auto-pull: Try to update entity for tracking ID: ${trackingID.toString()}`);
        // update the object
        await updateEntity(client, entity, eventIds);
      }
    }
    client.queryObject("COMMIT");
  } catch (error) {
    if (client) {
      client.queryObject("ROLLBACK");
    }
    logger.error(error);
  } finally {
    if (client) {
      client.release();
    }
  }
}
