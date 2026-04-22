/**
 * @file post_actions.ts
 * @description Post-processing actions for tracking entities, including validation
 * and monitoring of critical status codes in shipment tracking data.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import {Entity} from "./model.ts";
import {logger, whereIsAPI} from "../tools/logger.ts";

export function postAction(entity: Entity): void {
    // whether entity is missing critical status code
    if (!entity.isStatusExist(3500)) return;

    const additionalData = entity.additional || {};
    const missingStatuses = entity.getMissingCriticalStatuses();
    for (const status of missingStatuses) {
        // Ignore 3300/3400 status for FDX if it's not cross border
        if (entity.id.startsWith("fdx") && additionalData.isCrossBorder === undefined && (status === 3300 || status === 3400)) {
            continue;
        }
        logger.warn(`${whereIsAPI("data_monitor")} Entity ${entity.id} missing critical status : ${status}`);
    }
}