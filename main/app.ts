/**
 * @file app.ts
 * @description A collection of functions for loading metadata from the file system.
 */

import { load } from "@std/dotenv";
import { config } from "../config.ts";
import { loadJSONFromFs } from "../tools/util.ts";
import {
  ApiParams,
  DataUpdateMethod,
  ErrorRegistry,
  ExceptionCode,
  StatusCode,
} from "./model.ts";

/**
 * Loads environment variables from a `.env` file and sets them in `Deno.env`.
 * @async
 * @returns {Promise<void>} A promise that resolves when the environment variables are loaded and set.
 * @throws {Error} If the `.env` file cannot be loaded or parsed.
 */
export async function loadEnv(): Promise<void> {
  // Set environment variables from the `.env` file if not already set
  const env = await load({ envPath: "./.env" });
  for (const [key, value] of Object.entries(env)) {
    // It's possible that the environment variable is already set in `Deno.env`.
    if (!Deno.env.get(key)) {
      Deno.env.set(key, value);
    }
  }

  // Set default environment variables if not specified
  const defaultEnv = {
    APP_ENV: "dev",
    DB_PORT: String(config.database.port),
    DB_NAME: config.database.name,
    APP_PULL_INTERVAL: String(config.app.pullInterval),
  };
  for (const [key, value] of Object.entries(defaultEnv)) {
    if (!Deno.env.get(key)) {
      Deno.env.set(key, value);
    }
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
  const status: Record<string, unknown> = await loadJSONFromFs(
    "./metadata/status_codes.jsonc",
  );
  StatusCode.initialize(status);

  const dataRetrievalMethods: Record<string, unknown> = await loadJSONFromFs(
    "./metadata/data_update_methods.jsonc",
  );
  DataUpdateMethod.initialize(
    dataRetrievalMethods as Record<string, Record<string, string>>,
  );

  const apiParams: Record<string, unknown> = await loadJSONFromFs(
      "./metadata/api_params.jsonc",
  );
  ApiParams.initialize(
      apiParams as Record<string, Record<string, string>>,
  );

  const exception: Record<string, unknown> = await loadJSONFromFs(
    "./metadata/exception_codes.jsonc",
  );
  ExceptionCode.initialize(exception);

  const errors: Record<string, unknown> = await loadJSONFromFs(
    "./metadata/error_codes.jsonc",
  );
  ErrorRegistry.initialize(errors);
}
