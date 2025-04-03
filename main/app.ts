/**
 * @file app.ts
 * @description A collection of functions for loading metadata from the file system.
 */

import { load } from "https://deno.land/std/dotenv/mod.ts";

import { loadJSONFromFs } from "../tools/util.ts";
import { CodeDesc, ErrorRegistry } from "./model.ts";

/**
 * Loads environment variables from a `.env` file and sets them in `Deno.env`.
 * @async
 * @returns {Promise<void>} A promise that resolves when the environment variables are loaded and set.
 * @throws {Error} If the `.env` file cannot be loaded or parsed.
 */
export async function loadEnv(): Promise<void> {
    const env = await load({ envPath: "./.env" });
    for (const [key, value] of Object.entries(env)) {
        // set environment variable to Deno.env
        Deno.env.set(key, value);
    }
}

/**
 * Loads metadata from the file system, including status codes and error definitions.
 * Initializes the `CodeDesc` and `ErrorRegistry` classes with the loaded data.
 * @async
 * @returns {Promise<void>} A promise that resolves when the metadata is loaded and initialized.
 * @throws {Error} If the JSON files cannot be loaded or parsed.
 */
export async function loadMetaData(): Promise<void> {
    const status: Record<string, any> = await loadJSONFromFs(
        "./metadata/codes.json",
    );
    CodeDesc.initialize(status);
    const errors: Record<string, any> = await loadJSONFromFs(
        "./metadata/errors.json",
    );
    ErrorRegistry.initialize(errors);
}