/**
 * @file scheduler.ts
 * @description Scheduler for synchronizing tracking routes with external data.
 * This module sets up a cron job to periodically fetch in-process tracking numbers,
 * query their latest status, and update the database accordingly. It handles
 * database transactions and error logging to ensure data consistency.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { getDbClient } from "../db/dbutil.ts";
import { whereIsAPI, logger } from "../tools/logger.ts";
import { requestWhereIs } from "./gateway.ts";
import { AppError, Entity, OperatorRegistry, TrackingID } from "./model.ts";
import { initApp } from "./app.ts";
import { postAction } from "./post_actions.ts";

await initApp();

// Add process exit handlers for better logging
Deno.addSignalListener("SIGTERM", () => {
  logger.info(`${whereIsAPI("startup")} Scheduler received SIGTERM, shutting down gracefully`);
  Deno.exit(0);
});

Deno.addSignalListener("SIGINT", () => {
  logger.info(`${whereIsAPI("startup")} Scheduler received SIGINT, shutting down gracefully`);
  Deno.exit(0);
});

// Log uncaught errors
globalThis.addEventListener("error", (event) => {
  logger.error(`${whereIsAPI("exception")} Uncaught error in scheduler: ${event.message}`);
  logger.error(`${whereIsAPI("exception")} Stack: ${event.error?.stack}`);
  Deno.exit(1);
});

// Log unhandled promise rejections
globalThis.addEventListener("unhandledrejection", (event) => {
  logger.error(`${whereIsAPI("exception")} Unhandled promise rejection in scheduler: ${event.reason}`);
  Deno.exit(1);
});

/**
 * Starts a scheduler that periodically synchronizes tracking routes.
 * The task runs every N minutes using a cron job.
 */
const intervalStr = Deno.env.get("APP_PULL_INTERVAL");
const parsed = Number.parseInt(intervalStr ?? "", 10);
const interval = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;

Deno.cron("Sync routes", { minute: { every: interval } }, async () => {
  const timeout = (interval / 2) * 60_000;
  logger.info(`${whereIsAPI("startup")} ==> syncRoutes cron job started: every ${interval} min, with a timeout ${timeout / 60_000} min`);

  await Promise.race([
    syncRoutes(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("syncRoutes timed out")), timeout)
    ),
  ]);
  logger.info(`${whereIsAPI("startup")} --> syncRoutes cron job ended`);
}).catch((err) => {
  handleError(err, "Deno.cron: Sync routes");
});



/**
 * Synchronizes tracking routes by fetching in-process tracking numbers,
 * querying their status, and updating the database if new events are found.
 * Handles database transactions and ensures proper rollback on errors.
 *
 *  * Different operators are processed differently:
 *  * - SFEX: Processed individually with their specific params (e.g., phone number)
 *  * - FDX: Processed in batches of up to 30, with no additional params required
 *  *
 * @throws {Error} If an error occurs during database operations or external requests.
 */
async function syncRoutes() {
  let inProcessTrackingNums: Record<string, unknown>;
  try {
    inProcessTrackingNums = await getDbClient().getInProcessingTrackingNums();
    logger.info(`${whereIsAPI("data_monitor")} --> Fetching in-process tracking numbers: ${Object.keys(inProcessTrackingNums).length}`);

    // Group tracking numbers by operator
    const groupedTrackingNums = groupTrackingNumsByOperator(inProcessTrackingNums);
    for (const [operator, trackingNums] of Object.entries(groupedTrackingNums)) {
      const batchSize = OperatorRegistry.getBatchSize(operator);
      if (batchSize <= 0) {
        logger.error(`${whereIsAPI("exception")} Invalid batch size for operator ${operator}, skipping`);
        continue;
      }
      const trackingIdBatches: Record<string, unknown>[] = getTrackingIdBatches(trackingNums, batchSize);

      for (let idx = 0; idx < trackingIdBatches.length; idx++) {
        const trackingIds: Record<string,unknown> = trackingIdBatches[idx];

        try {
          if (Object.keys(trackingIds).length === 1) {
             // Process tracking numbers one by one(eg: sfex)
            const [id] = Object.keys(trackingIds);
            logger.info(`${whereIsAPI("data_monitor")} Process auto-pull for trackingId: ${id}`);
            await processTrackingIds(operator, [TrackingID.parse(id)], trackingIds[id] as Record<string, string>);
          } else {
            // Process tracking numbers in batches(eg: fdx)
            const ids = Object.keys(trackingIds).map((id) => TrackingID.parse(id));
            await processTrackingIds(operator, ids, {});
          }
        } catch (err) {
          handleError(err, `syncRoutes batch ${idx} for ${operator}`);
        }
      }
    }
  } catch (err) {
    handleError(err, 'syncRoutes');
  }
}

/**
 * Groups tracking numbers by operator.
 * @param inProcessTrackingNums Record of tracking numbers with their parameters
 * @returns Record of operators with their corresponding tracking numbers and parameters
 */
function groupTrackingNumsByOperator(inProcessTrackingNums: Record<string, unknown>): Record<string, Record<string, unknown>> {
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

function getTrackingIdBatches(trackingIds: Record<string, unknown>, batchSize: number): Record<string, unknown>[] {
  const batches: Record<string, unknown>[] = [];
  const ids = Object.keys(trackingIds);

  // Create batches of tracking IDs with their parameters
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch: Record<string, unknown> = {};
    const batchIds = ids.slice(i, i + batchSize);

    for (const id of batchIds) {
      batch[id] = trackingIds[id];
    }

    batches.push(batch);
  }
  return batches;
}

/**
 * Processes tracking IDs by fetching their latest status from an external provider,
 * comparing with existing database records, and updating the database if changes are detected.
 *
 * This function performs three main steps:
 * 1. Fetches the latest tracking status from the external data provider
 * 2. Compares event IDs between the database and freshly fetched data
 * 3. Updates the database only if new events are found or existing events are removed
 *
 * @param operator - The shipping operator identifier (e.g., "sfex", "fdx")
 * @param trackingIds - Array of tracking IDs to process
 * @param params - Additional parameters required by the operator (e.g., phone number for SFEX)
 * @returns A promise that resolves when all tracking IDs have been processed and database updates are complete
 *
 * @async
 */
async function processTrackingIds(operator: string, trackingIds: TrackingID[], params: Record<string, string>): Promise<void> {
  const updateMethod = "auto-pull";
  // step 1: fetch latest status from external data provider
  const entities: Entity[] = await requestWhereIs(operator, trackingIds, params as Record<string, string>, updateMethod);
  if (entities.length === 0) return;

  // step 2: compare eventIds in the database and fresh eventIds
  for (const entity of entities) {
    try {
      const eventIdsInDb: string[] = await getDbClient().queryEventIds(TrackingID.parse(entity.id));
      // update the database on-demand
      const {dataChanged, eventIdsNew, eventIdsToBeRemoved} = entity.compare(eventIdsInDb);
      if (dataChanged) {
        await getDbClient().updateEntity(entity, updateMethod, eventIdsNew, eventIdsToBeRemoved);
      }
      // post-processing
      postAction(entity);
    } catch (err) {
      handleError(err, `processTrackingIds entity ${entity.id}`);
    }
  }
}

/**
 * Centralized error handler for scheduled tasks.
 *
 * This function handles different types of errors appropriately:
 * - AppError with 4xx status: Treated as user errors, not logged (user-facing issues)
 * - AppError with 5xx status: Logged as server errors (system issues)
 * - Generic Error: Logged with full details including stack trace and cause
 * - Unknown errors: Logged as strings
 *
 * @param err - The error to handle (can be AppError, Error, or unknown type)
 * @param context - A string describing where the error occurred (e.g., function name)
 */
function handleError(err: unknown, context: string):void {
  // ignore the UserError
  if (err instanceof AppError) {
    if (err.getHttpStatusCode() >= 500) {
      logger.error(`${whereIsAPI("exception")} ${context}: ${err.getMessage()}`);
    }
  } else {
    if (err instanceof Error) {
      logger.error(`${whereIsAPI("exception")} ${context}: ${err.message}`);
      if (err.stack) {
        logger.error(`${whereIsAPI("exception")} Stack trace: ${err.stack}`);
      }
      if (err.cause) {
        logger.error(`${whereIsAPI("exception")} Caused by: ${err.cause}`);
      }
    } else {
      logger.error(`${whereIsAPI("exception")} Unknown error in ${context}: ${String(err)}`);
    }
  }
}


