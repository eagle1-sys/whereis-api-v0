/**
 * @file operator.ts
 * @description Interface definition for operator modules
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { Entity, TrackingID } from "./model.ts";

/**
 * Interface that all operator modules must implement.
 * Defines the contract for carrier-specific tracking operations.
 */
export interface OperatorModule {
    validateTrackingNum(trackingNum: string): void;

    getExtraParams(params: Record<string, string>): Record<string, string>;

    validateParams(trackingId: TrackingID, params: Record<string, string>): boolean;

    validateStoredEntity(entity: Entity, params: Record<string, string>): boolean;

    pullFromSource(trackingIds: TrackingID[], extraParams: Record<string, string>, updateMethod: string): Promise<Entity[]>;

    processPushData(jsonData: Record<string, unknown>): Entity[];
}