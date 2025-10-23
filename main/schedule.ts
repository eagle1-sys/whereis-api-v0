/**
 * @file schedule.ts
 * @description Scheduler for synchronizing tracking routes with external data.
 * This module sets up a cron job to periodically fetch in-process tracking numbers,
 * query their latest status, and update the database accordingly. It handles
 * database transactions and error logging to ensure data consistency.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { dbClient } from "../db/dbutil.ts";
import { logger } from "../tools/logger.ts";
import { requestWhereIs } from "./gateway.ts";
import { AppError, Entity, TrackingID } from "./model.ts";

/**
 * Groups tracking numbers by operator.
 * @param inProcessTrackingNums Record of tracking numbers with their parameters
 * @returns Record of operators with their corresponding tracking numbers and parameters
 */
function groupTrackingNumsByOperator(
  inProcessTrackingNums: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const groupedByOperator: Record<string, Record<string, unknown>> = {};

  for (const [id, params] of Object.entries(inProcessTrackingNums)) {
    const [operator] = id.split("-");

    if (!groupedByOperator[operator]) {
      groupedByOperator[operator] = {};
    }

    groupedByOperator[operator][id] = params;
  }

  return groupedByOperator;
}

async function processTrackingIds(
  operator: string,
  trackingIds: TrackingID[],
  params: Record<string, string>,
): Promise<void> {
  // step 1: fetch latest status from external data provider
  const entities: Entity[] = await requestWhereIs(
    operator,
    trackingIds,
    params as Record<string, string>,
    "auto-pull",
  );
  if (entities.length === 0) return;

  // step 2: compare eventIds in the database and fresh eventIds
  for (const entity of entities) {
    let dataChanged = true; // assume data changed
    const eventIdsFresh: string[] = entity.eventIds();
    const eventIdsInDb: string[] = await dbClient.queryEventIds(
      TrackingID.parse(entity.id),
    );
    const dbSet = new Set(eventIdsInDb);
    const freshSet = new Set(eventIdsFresh);
    const eventIdsNew = eventIdsFresh.filter((id) => !dbSet.has(id));
    const eventIdsToBeRemoved = eventIdsInDb.filter((id) => !freshSet.has(id));
    if (eventIdsNew.length === 0 && eventIdsToBeRemoved.length === 0) {
      dataChanged = false; // no change in data
    }

    // step 3：update the database
    if (dataChanged) {
      await dbClient.updateEntity(entity, eventIdsNew, eventIdsToBeRemoved);
    }
  }
}

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
    inProcessTrackingNums = await dbClient.getInProcessingTrackingNums();

    // Group tracking numbers by operator
    const groupedTrackingNums = groupTrackingNumsByOperator(
      inProcessTrackingNums,
    );

    for (
      const [operator, trackingNums] of Object.entries(groupedTrackingNums)
    ) {
      if (operator === "sfex") {
        for (const [id, params] of Object.entries(trackingNums)) {
          await processTrackingIds(
            operator,
            [TrackingID.parse(id)],
            params as Record<string, string>,
          );
        }
      } else if (operator === "fdx") {
        const batchSize = 10;
        const trackingIdBatches: TrackingID[][] = [];
        const ids = Object.keys(trackingNums);
        // Create batches of tracking IDs
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize).map((id) =>
            TrackingID.parse(id)
          );
          trackingIdBatches.push(batch);
        }

        for (let idx = 0; idx < trackingIdBatches.length; idx++) {
          await processTrackingIds(operator, trackingIdBatches[idx], {});
        }
      }
    }
  } catch (err) {
    // ignore the UserError
    if (err instanceof AppError) {
      if (err.getHttpStatusCode() > 500) {
        logger.error(`SyncRoutes: ${err.getMessage()}`);
      }
    } else {
      if (err instanceof Error) {
        logger.error(`SyncRoutes: ${err.message}`);
        if (err.stack) {
          logger.error(`Stack trace: ${err.stack}`);
        }
        if (err.cause) {
          logger.error(`Caused by: ${err.cause}`);
        }
      } else {
        logger.error(`Unknown error in syncRoutes: ${String(err)}`);
      }
    }
  }
}