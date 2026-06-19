/**
 * @file api_key.ts
 * @description Command-line utility for generating and storing API keys in the database.
 * This script creates secure, URL-safe API keys and associates them with user identifiers.
 * It supports custom key generation or accepts pre-defined keys via command-line arguments.
 *
 * Usage:
 *   deno task api_key                              # Generate key for default user
 *   deno task api_key --user=admin                 # Generate key for specific user
 *   deno task api_key --key=sk-abc123 --user=test  # Store custom key
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import { loadEnv } from "../main/app.ts";
import { initConnection } from "./dbutil.ts";
import { whereIsAPI, logger } from "../tools/logger.ts";
import { getDbClient } from "./dbutil.ts";

async function main(): Promise<void> {
  // step 1: load environment variable first
  await loadEnv();

  // step 2: initialize database connection
  await initConnection();

  // step 3: generate API key
  let { user = "formal_user", key = "" } = parseArgs(Deno.args);
  if (!key) {
    key = generateApiKey();
  }

  // step 3: write API key to the database
  const inserted = await getDbClient().insertToken(key, user);
  // Just output the API key to console (Avoid writing to grafana)
  if (!inserted) {
    console.log(`Token ${key} already exists or could not be inserted.`);
  } else {
    console.log(`API key ${key} has been saved to the database.`);
  }
}

function parseArgs(args: string[]) {
  const result: Record<string, string> = {};
  args.forEach((arg) => {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      result[key] = value;
    }
  });
  return result;
}

/**
 * Generates a unique, URL-safe API key with a given length.
 */
function generateApiKey(length: number = 48): string {
  if (!Number.isInteger(length) || length < 16 || length > 128) {
    throw new RangeError("API key length must be an integer between 16 and 128.");
  }

  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  // Use rejection sampling to avoid modulo bias when mapping random bytes to characters.
  const maxUnbiased = Math.floor(256 / chars.length) * chars.length;
  const keyChars: string[] = [];

  while (keyChars.length < length) {
    const randomBytes = crypto.getRandomValues(
      new Uint8Array(length - keyChars.length),
    );

    for (const byte of randomBytes) {
      if (byte >= maxUnbiased) {
        continue;
      }
      keyChars.push(chars[byte % chars.length]);
      if (keyChars.length === length) {
        break;
      }
    }
  }

  return `sk-${keyChars.join("")}`;
}

// Execute the main function and handle any uncaught errors
main().catch((err) => {
  logger.error(`${whereIsAPI("exception")} Failed to start application:${err}`);
  Deno.exit(1);
});
