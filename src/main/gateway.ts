/**
 * @file gateway.ts
 * @description utility module for retrieving shipment location information
 * from various carriers using their tracking IDs.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { HonoRequest } from "hono/request";
import { Entity, OperatorRegistry, TrackingID } from "./model.ts";
import {OperatorModule} from "./operator.ts";
import {logger} from "../tools/logger.ts";

// Define a type for the operator status
type OperatorStatus = {
  [key: string]: boolean;
};

// Define the operator status variable
const operatorStatus: OperatorStatus = {};

// Registry for operator modules
const operatorModules: Record<string, OperatorModule> = {};

/**
 * Checks if a given operator is active.
 *
 * @param {string} operator - The operator code to check.
 * @returns {boolean} True if the operator is active, false otherwise.
 */
export function isOperatorActive(operator: string): boolean {
  return operatorStatus[operator] ?? false;
}

/**
 * Sets the status of an operator
 * @param operator - The operator code
 * @param status - The status to set (true for on, false for off)
 */
export function setOperatorStatus(operator: string, status: boolean): void {
  if (OperatorRegistry.getActiveOperatorCodes().includes(operator)) {
    operatorStatus[operator] = status;
  } else {
    throw new Error(`Invalid operator: ${operator}`);
  }
}

/**
 * Registers a new operator module dynamically.
 * This allows adding new operators without modifying the gateway code.
 *
 * @param {string} operatorCode - The operator code to register
 * @param {OperatorModule} module - The operator module implementing the OperatorModule interface
 */
export function registerOperatorModule(operatorCode: string, module: OperatorModule): void {
  operatorModules[operatorCode] = module;
}

export function validateTrackingNum(operator: string, trackingNum: string): void {
  const operatorModule = getOperatorModule(operator);

  operatorModule.validateTrackingNum(trackingNum);
}

export function getExtraParams(operator: string, req: HonoRequest): Record<string, string> {
  const operatorModule = getOperatorModule(operator);

  return operatorModule.getExtraParams(req.query());
}

export function validateParams(operator: string, trackingId: TrackingID, params: Record<string, string>): boolean {
  const operatorModule = getOperatorModule(operator);

  return operatorModule.validateParams(trackingId, params);
}

export function validateStoredEntity(operator: string, entity: Entity, params: Record<string, string>): boolean {
  const operatorModule = getOperatorModule(operator);

  return operatorModule.validateStoredEntity(entity, params);
}

/**
 * Asynchronously retrieves the location information for a given tracking ID.
 * Supports different carriers (SF Express and FedEx) and handles their specific implementations.
 *
 * @param {string} operator - The carrier code (e.g., "sfex" for SF Express or "fdx" for FedEx)
 * @param {TrackingID} trackingIds - The tracking identifier containing carrier and tracking number
 * @param {Record<string, string>} extraParams - Additional parameters for SF Express tracking requests
 * @param {string} updateMethod - The method to use for updating tracking information
 * @returns {Promise<Entity[]>} A promise that resolves to the tracking entities
 * @async
 */
export async function requestWhereIs(operator: string, trackingIds: TrackingID[], extraParams: Record<string, string>, updateMethod: string,): Promise<Entity[]> {
  const operatorModule = getOperatorModule(operator);

  const entities: Entity[] = await operatorModule.pullFromSource(trackingIds, extraParams, updateMethod);

  // whether entity is missing critical status code
  for (const entity of entities) {
    if (!entity.isStatusExist(3500)) continue;

    const missingStatuses = entity.getMissingMajorStatuses();
    for (const status of missingStatuses) {
      logger.warn(`Entity ${entity.id} missing critical status : ${status}`);
    }
  }
  return entities;
}

/**
 * Processes push data from a carrier's webhook or push notification system.
 * Delegates the processing to the appropriate operator module to parse and transform
 * the tracking data into standardized entities.
 *
 * @param operator - The carrier code identifying which operator module to use for processing
 * @param trackingData - The raw tracking data received from the carrier's push notification
 * @returns An array of parsed Entity objects representing the tracking information
 */
export function processPushData(operator: string, trackingData: Record<string, unknown>): Entity[] {
  const operatorModule = getOperatorModule(operator);

  return operatorModule.processPushData(trackingData);
}

function getOperatorModule(operator: string): OperatorModule {
  const operatorModule = operatorModules[operator];
  if (!operatorModule) {
    throw new Error(`Operator module not found: ${operator}`);
  }
  return operatorModule;
}