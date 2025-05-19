/**
 * @file util.ts
 * @description Utilities for loading JSON files and calculating MD5 hashes.
 * Provides functions to read JSON from filesystem and generate MD5 checksums
 * from JSON objects using Deno's crypto module.
 */

import { crypto } from "jsr:@std/crypto@0.224.0";


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
    try {
        // read file content
        const jsonString = await Deno.readTextFile(filePath);
        // parse
        return JSON.parse(jsonString);
    } catch (error) {
        console.error("Error loading JSON file:", error);
        throw error;
    }
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
