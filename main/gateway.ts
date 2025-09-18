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
        trackingIds,
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

/**
 * Parses JSON from a Response when Content-Type indicates JSON or when content-type is missing;
 * Handles various JSON content-types and edge cases like 204 responses and empty bodies.
 *
 * @param response - The Response object from the fetch call
 * @param uniqueId - A unique identifier string for logging purposes
 * @returns The JSON content of the response
 * @throws Error if the content type is not JSON-like or parsing fails
 */
export async function getResponseJSON(response: Response, uniqueId: string): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type");

  // Handle 204 No Content responses - return empty object
  if (response.status === 204) {
    return {};
  }

  // Check if content-type indicates JSON or JSON-like content
  const isJsonContent = contentType ? isJsonContentType(contentType) : false;

  // If no content-type header, attempt to parse as JSON (some APIs omit headers)
  // Or if content-type indicates JSON, proceed with parsing
  if (!contentType || isJsonContent) {
    try {
      const text = await response.text();

      // Handle empty responses - return empty object
      if (!text.trim()) {
        return {};
      }

      return JSON.parse(text);
    } catch (error) {
      if (!contentType) {
        throw new Error(`Failed to parse response as JSON (no content-type header): ${error instanceof Error ? error.message : String(error)} [${uniqueId}]`);
      }
      throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)} [${uniqueId}]`);
    }
  }

  throw new Error(`Unexpected content type: ${contentType} [${uniqueId}]`);
}

/**
 * Helper function to check if a content-type indicates JSON content
 * @param contentType - The content-type header value
 * @returns true if the content-type indicates JSON content
 */
function isJsonContentType(contentType: string): boolean {
  const normalizedType = contentType.toLowerCase().trim();

  // Common JSON content types
  const jsonTypes = [
    'application/json',
    'application/problem+json',
    'application/vnd.api+json',
    'application/hal+json',
    'application/ld+json',
    'text/json'
  ];

  return jsonTypes.some(type => normalizedType.includes(type)) ||
      // Generic check for any +json suffix (handles future JSON variants)
      /[\/+]json($|;|\s)/.test(normalizedType);
}
