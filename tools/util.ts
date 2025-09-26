/**
 * @file util.ts
 * @description Utilities for loading JSON files and calculating MD5 hashes.
 * Provides functions to read JSON from filesystem and generate MD5 checksums
 * from JSON objects using Deno's crypto module.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { crypto } from "@std/crypto";
import { parse } from "@std/jsonc";

/**
 * Asynchronously loads and parses a JSON file from the filesystem.
 *
 * @async
 * @function loadJSONFromFs
 * @param {string} filePath - The path to the JSON file to be loaded
 * @returns {Promise<Record<string, unknown>>} A promise that resolves to the parsed JSON object
 * @throws {Error} If file reading or JSON parsing fails
 */
export async function loadJSONFromFs(
  filePath: string,
): Promise<Record<string, unknown>> {
  // read file content
  const jsonString = await Deno.readTextFile(filePath);
  // parse
  let v;
  try {
    v = parse(jsonString);
  } catch (error) {
    throw new Error(`Failed to parse JSONC file '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`Invalid JSON file format: ${filePath}`);
  }
  return v as Record<string, unknown>;
}

/**
 * Calculates the MD5 hash of a JSON object.
 *
 * @async
 * @function jsonToMd5
 * @param {Record<string, unknown>} json - The JSON object to hash
 * @returns {Promise<string>} A promise that resolves to the MD5 hash as a hexadecimal string
 * @example
 * ```typescript
 * const json = { foo: "bar" };
 * const hash = await jsonToMd5(json);
 * console.log(hash); // outputs MD5 hash as hex string
 * ```
 */
export async function jsonToMd5(
  json: Record<string, unknown>,
): Promise<string> {
  // Convert JSON object to string
  const jsonString = JSON.stringify(json);

  // Convert json stringto Uint8Array
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonString);

  // Calcualte MD5
  const hashBuffer = await crypto.subtle.digest("MD5", data);

  // Convert HASH value to Hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Formats a timezone offset into a string representation.
 *
 * @param offset - The timezone offset in hours. Positive values represent offsets east of UTC,
 *                 negative values represent offsets west of UTC.
 * @returns A string representation of the timezone offset in the format "+HH:MM" or "-HH:MM".
 *          For example, 5.5 returns "+05:30", -3.25 returns "-03:15".
 */
export function formatTimezoneOffset(offset: number): string {
  const sign = offset >= 0 ? "+" : "-";
  const absOffset = Math.abs(offset);
  const totalMinutes = Math.round(absOffset * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const formattedHours = String(hours).padStart(2, "0");
  const formattedMinutes = String(minutes).padStart(2, "0");

  return `${sign}${formattedHours}:${formattedMinutes}`;
}

/**
 * Extracts the timezone offset from a date string in various ISO8601 formats.
 *
 * This function supports the following timezone formats:
 * - Trailing 'Z' for UTC
 * - ±HH:MM
 * - ±HHMM
 * - ±HH
 *
 * @param dateString - The date string from which to extract the timezone.
 *                     This should be a string representation of a date that includes
 *                     timezone information in one of the supported formats.
 *
 * @returns The timezone offset in hours as a number.
 *          Positive values represent offsets east of UTC, negative values west of UTC.
 *          Returns 0 for UTC or if no valid timezone information is found.
 */
export function extractTimezone(dateString: string): number {
  // Support trailing 'Z' (UTC) and various ISO8601 timezone formats: ±HH:MM, ±HHMM, ±HH
  if (/[Zz]$/.test(dateString)) return 0;

  // Try ±HH:MM format first
  let match = dateString.match(/([+-])(\d{2}):(\d{2})$/);
  if (match) {
    const sign = match[1] === "+" ? 1 : -1;
    const hours = parseInt(match[2], 10);
    const minutes = parseInt(match[3], 10);
    return getTimezoneOffset(sign, hours, minutes);
  }

  // Try ±HHMM format
  match = dateString.match(/([+-])(\d{4})$/);
  if (match) {
    const sign = match[1] === "+" ? 1 : -1;
    const timeStr = match[2];
    const hours = parseInt(timeStr.substring(0, 2), 10);
    const minutes = parseInt(timeStr.substring(2, 4), 10);
    return getTimezoneOffset(sign, hours, minutes);
  }

  // Try ±HH format
  match = dateString.match(/([+-])(\d{2})$/);
  if (match) {
    const sign = match[1] === "+" ? 1 : -1;
    const hours = parseInt(match[2], 10);

    if (
        (sign === 1 && hours > 14) ||
        (sign === -1 && hours > 12)
    ) {
      return 0;
    }
    return getTimezoneOffset(sign, hours, 0);
  }

  return 0;
}

/**
 * Calculates the timezone offset in hours based on the provided sign, hours, and minutes.
 *
 * @param sign - The sign of the offset. 1 for positive (east of UTC), -1 for negative (west of UTC).
 * @param hours - The number of hours in the timezone offset.
 * @param minutes - The number of minutes in the timezone offset.
 * @returns The timezone offset in hours as a number. Returns 0 if the offset is invalid.
 */
function getTimezoneOffset(sign:number, hours:number, minutes:number): number {
  if (minutes > 59) return 0;

  if (
      (sign === 1 && (hours > 14 || (hours === 14 && minutes > 0))) ||
      (sign === -1 && (hours > 12 || (hours === 12 && minutes > 0)))
  ) {
    return 0;
  }
  return sign * (hours + minutes / 60);
}

/**
 * Adjusts a given date by subtracting one second and formats it according to a specified timezone.
 *
 * @param basedOnDate - The original Date object to be adjusted.
 * @param timeZone - The timezone offset in hours (e.g., 8 for UTC+8, -5 for UTC-5).
 * @returns A tuple containing:
 *   - number: The adjusted date as seconds since the Unix epoch.
 *   - string: The adjusted date formatted as an ISO 8601 string with the specified timezone offset.
 */
export function adjustDateAndFormatWithTimezone(
  basedOnDate: Date,
  timeZone: number,
): [number, string] {
  // Set supplement event time 1 second before the base event
  const adjustedDate = new Date(basedOnDate.getTime() - 1000);
  const secondsSinceEpoch = Math.floor(adjustedDate.getTime() / 1000);
  // Adjust for timezone defined in the configuration
  const utcDate = new Date(
    adjustedDate.getTime() + (timeZone * 60 * 60 * 1000),
  );
  // Format the date to "2024-10-26T06:12:43+08:00"
  const formattedDate = utcDate.toISOString().replace(
    /\.\d{3}Z$/,
    formatTimezoneOffset(timeZone),
  );

  return [secondsSinceEpoch, formattedDate];
}
