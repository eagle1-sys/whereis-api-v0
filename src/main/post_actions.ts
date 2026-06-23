/**
 * @file post_actions.ts
 * @description Post-processing actions for tracking entities, including validation
 * and monitoring of critical status codes in shipment tracking data.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { Entity } from "./model.ts";
import { logger, whereIsAPI } from "../tools/logger.ts";

export function postAction(entity: Entity): void {
  // Skip if entity is missing the required baseline status code
  if (!entity.isStatusExist(3500)) {
    return;
  }

  const isFdx = entity.id.startsWith("fdx");
  const isCrossBorder = entity.additional?.isCrossBorder === true;

  for (const status of entity.getMissingCriticalStatuses()) {
    // Ignore 3300/3400 status for FDX if it's not cross border
    if (isFdx && !isCrossBorder && (status === 3300 || status === 3400)) {
      continue;
    }

    logger.warn(
      `${whereIsAPI("data_monitor")} Entity ${entity.id} is missing major status: ${status}`,
    );
  }
}
