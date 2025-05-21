/**
 * @file schedule.ts
 * @description Scheduler for synchronizing tracking routes with external data.
 * This module sets up a cron job to periodically fetch in-process tracking numbers,
 * query their latest status, and update the database accordingly. It handles
 * database transactions and error logging to ensure data consistency.
 */
import { sql } from "../db/dbutil.ts";
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
  let inProcessTrackingNums: Record<string, unknown>;
  try {
    inProcessTrackingNums = await getInProcessingTrackingNums(sql);

    await sql.begin(async sql => {
      for (const [id, params] of Object.entries(inProcessTrackingNums)) {
        const trackingID = TrackingID.parse(id);

        const entity: Entity | undefined = await requestWhereIs(
            trackingID,
            params as Record<string, string>,
            "auto-pull",
        );
        if (entity === undefined) continue;

        const eventIds: string[] = await queryEventIds(
            sql,
            trackingID,
        );
        if (entity instanceof Entity && entity.isRevised(eventIds)) {
          // update the object
          await updateEntity(sql, entity, eventIds);
        }
      }
      return true;
    });
  } catch (error) {
    logger.error(error);
  }
}
