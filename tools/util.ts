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
    const v = parse(jsonString);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
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
 * @param offset - The timezone offset in hours. Positive values represent offsets ahead of UTC,
 *                 while negative values represent offsets behind UTC.
 * @returns A string representation of the timezone offset in the format "+HH:MM" or "-HH:MM".
 *          The hours are always two digits, and the minutes are always "00".
 */
export  function formatTimezoneOffset(offset: number): string {
    const sign = offset >= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    const hours = String(Math.floor(absOffset)).padStart(2, '0');
    const minutes = '00';
    return `${sign}${hours}:${minutes}`;
}

/**
 * Extracts the timezone offset in hours from an ISO 8601 formatted date string.
 * @param dateString - The ISO 8601 formatted date string.
 * @returns The timezone offset as a number (e.g., 8 for "+08:00", -6 for "-06:00") or 0 if not found.
 */
export function extractTimezone(dateString: string): number {
    const timezoneRegex = /([+-])(\d{2}):(\d{2})$/;
    const match = dateString.match(timezoneRegex);

    if (match) {
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2], 10);
        return sign * hours;
    }

    return 0; // Return 0 if no timezone information is found
}

/**
 * Adjusts a given date by subtracting one second and formats it according to a specified timezone.
 *
 * @param date - The original Date object to be adjusted.
 * @param timeZone - The timezone offset in hours (e.g., 8 for UTC+8, -5 for UTC-5).
 * @returns A tuple containing:
 *   - number: The adjusted date as seconds since the Unix epoch.
 *   - string: The adjusted date formatted as an ISO 8601 string with the specified timezone offset.
 */
export function adjustDateAndFormatWithTimezone(date: Date, timeZone: number): [number, string] {
    // Set supplement event time 1 second before the base event
    date.setMilliseconds(date.getMilliseconds() - 1000);
    const secondsSinceEpoch = Math.floor(date.getTime() / 1000);

    // Adjust for timezone defined in the configuration
    const utcDate = new Date(date.getTime() + (timeZone * 60 * 60 * 1000));
    // Format the date to "2024-10-26T06:12:43+08:00"
    const formatedDate = utcDate.toISOString().replace(/\.\d{3}Z$/, formatTimezoneOffset(timeZone));

    return [secondsSinceEpoch, formatedDate];
}
