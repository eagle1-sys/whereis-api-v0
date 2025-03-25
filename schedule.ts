/**
 * @fileoverview Scheduler for synchronizing tracking routes with external data.
 * This module sets up a cron job to periodically fetch in-process tracking numbers,
 * query their latest status, and update the database accordingly. It handles
 * database transactions and error logging to ensure data consistency.
 *
 * @author samshdn
 * @version 0.1.1
 * @date 2025-02-28
 */
import { connect } from "./database/dbutil.ts";
import {
    getInProcessingTrackingNums,
    queryEventIds,
    updateEntity,
} from "./database/dbop.ts";
import { logger } from "./logger.ts";
import { requestWhereIs } from "./gateway.ts";
import { TrackingID } from "./model.ts";

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
    let inProcessTrackingNums: Record<string, any>;
    try {
        client = await connect();
        inProcessTrackingNums = await getInProcessingTrackingNums(client);

        client.queryObject("BEGIN");
        // for (const inProcessTrackingNum of inProcessTrackingNums) {
        for (const [id, params] of Object.entries(inProcessTrackingNums)) {
            const [error, trackingID] = TrackingID.parse(id);
            if (trackingID === undefined) {
                continue;
            }

            const entity = await requestWhereIs(trackingID, params, "auto-pull");
            if (entity === undefined) continue;

            const eventIds: string[] = await queryEventIds(
                client,
                trackingID,
            );
            if (entity.eventNum() > eventIds.length) {
                // update the entity
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
