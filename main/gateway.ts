/**
 * @file gateway.ts
 * @description utility module for retrieving shipment location information
 * from various carriers using their tracking IDs.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { Sfex } from "../operators/sfex.ts";
import { Fdx } from "../operators/fdx.ts";
import { Entity, OperatorRegistry, TrackingID } from "./model.ts";

// Define a type for the operator status
type OperatorStatus = {
  [key: string]: boolean;
};

// Define the operator status variable
const operatorStatus: OperatorStatus = {};

export function isOperatorActive(operator: string): boolean {
    return operatorStatus[operator] === true;
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
export async function requestWhereIs(
  operator: string,
  trackingIds: TrackingID[],
  extraParams: Record<string, string>,
  updateMethod: string,
): Promise<Entity[]> {
  let entities: Entity[] = [];
  switch (operator) {
    case "sfex":
      entities = await Sfex.whereIs(
        trackingIds[0],
        extraParams,
        updateMethod,
      );
      break;
    case "fdx":
      entities = await Fdx.whereIs(trackingIds, updateMethod);
      break;
  }
  return entities;
}
