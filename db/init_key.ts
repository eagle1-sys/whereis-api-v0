/**
 * @file init_key.ts

 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */
import {loadEnv} from "../main/app.ts";
import {initConnection} from "./dbutil.ts";
import { getLogger  } from "../tools/logger.ts";
import { dbClient} from "./dbutil.ts";


async function main(): Promise<void> {
    // step 1: load environment variable first
    await loadEnv();

    // step 2: initialize database connection
    await initConnection();

    // step 3: generate API key
    let {user = "formal_user", key = ""} = parseArgs(Deno.args);
    if (key === "" || key === undefined) {
        key = generateApiKey();
    }

    const logger = getLogger();
    // step 3: write API key to the database
    const inserted = await dbClient.insertToken(key, user);
    if (!inserted) {
        logger.warn(`Token ${key} already exists or could not be inserted.`);
        return;
    } else {
        // output the API key to the console or log
        logger.info(`API key ${key} has been saved to the database.`);
    }
}

function parseArgs(args: string[]) {
    const result: Record<string, string> = {};
    args.forEach(arg => {
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
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    // Generate random bytes and map to alphanumeric characters
    const randomBytes = crypto.getRandomValues(new Uint8Array(length));
    const key = Array.from(randomBytes)
        .map(byte => chars[byte % chars.length])
        .join('');
    return `sk-${key}`;
}

// Execute the main function and handle any uncaught errors
main().catch((err) => {
    const logger = getLogger();
    logger.error("Failed to start application:", err);
    Deno.exit(1);
});