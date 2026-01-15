/**
 * @file watcher.ts
 * @description Interactive command-line tool for querying and analyzing application logs from Grafana.
 *
 * This utility provides a REPL (Read-Eval-Print Loop) interface for developers to interactively
 * query logs stored in Grafana.
 */
import { Grafana } from "./grafana.ts";
import { loadEnv } from "../main/app.ts";

const MILLIS_PER_HOUR = 60 * 60 * 1000;

/**
 * Initializes and runs the interactive REPL (Read-Eval-Print Loop) interface for the log watcher tool.
 *
 * @returns A promise that resolves when the REPL loop exits. The function runs indefinitely
 *          until the user exits or an error occurs, at which point it either terminates the
 *          process or breaks from the loop.
 */
async function main() {
    // step 1: load environment variable first
    await loadEnv();

    console.log("=== Console Input Handler ===");
    console.log('Type "help" for available commands\n');
    while (true) {
        try {
            const input = await readLine("");
            const parts = input.trim().split(/\s+/);
            const command = parts[0].toLowerCase();

            switch (command) {
                case "help":
                    console.log("\nAvailable commands:");
                    console.log("  help    - Show this help message");
                    console.log("  log     - Read log from grafana");
                    console.log("  exit    - Exit the program");
                    console.log();
                    break;

                case "log": {
                    await analyseLog(parts.slice(1));
                    break;
                }

                case "exit": {
                    console.log("Goodbye!");
                    return;
                }

                default: {
                    console.log(`Unknown command: "${input}"`);
                    console.log('Type "help" for available commands\n');
                    break;
                }

            }
        } catch (error) {
            console.error("Error reading input:", error);
            break;
        }
    }
}

/**
 * Analyzes and retrieves application logs from Grafana based on command-line parameters.
 *
 * This function processes user-provided parameters to determine a time range, queries logs
 * from Grafana within that range, and outputs the results as formatted JSON to the console.
 * It handles errors gracefully by delegating to the error handler.
 *
 * @param args - An array of command-line argument strings used to specify the time range
 *                 for the log query. Supported formats include "--h=<hours>", "--d=<days>",
 *                 and "--span=<hours>".
 * @returns A promise that resolves when the log analysis is complete. The function does not
 *          return a value but outputs the log results directly to the console.
 */
async function analyseLog(args: string[]): Promise<void> {
    // step 1: get time range from user input
    const {start, end} = getTimeRangeFromArgs(args);

    // step 2: initialize Grafana instance
    const grafana = Grafana.getInstance();

    let logs;
    // step 3: query logs from Grafana within the specified time range
    try {
        logs = await grafana.queryLog({
            start: start,
            end: end
        });
        console.log(JSON.stringify(logs, null, 2));
    } catch (err) {
        errorHandler(err);
    }

    if (logs === undefined) return;

    // todo: step 4: analyse the logs
    // ...
}

/**
 * Parses command-line arguments to extract and calculate a time range for log queries.
 *
 * This function processes an array of command-line parameters to determine the start and end
 * timestamps for querying logs. It supports three argument formats:
 * - `--h=<hours>`: Specifies how many hours back from now to start the query
 * - `--d=<days>`: Specifies how many days back from now to start the query (converted to hours)
 * - `--span=<hours>`: Specifies the duration of the time range in hours
 *
 * If invalid or missing values are provided, defaults to 24 hours for both lookback and span.
 * The start time is calculated as the current time minus the specified hours, and the end time
 * is calculated as the start time plus the span duration.
 *
 * @param args - An array of command-line argument strings to parse. Expected formats include
 *                 "--h=<number>", "--d=<number>", and "--span=<number>".
 * @returns An object containing the calculated time range with two properties:
 *          - `start`: The start timestamp in milliseconds since Unix epoch
 *          - `end`: The end timestamp in milliseconds since Unix epoch
 */
function getTimeRangeFromArgs(args: string[]): { start: number; end: number } {
    let hours = 24, span: number = 24;

    args.forEach(arg => {
        if (arg.startsWith("--h=")) {
            const value = arg.slice(4);
            const parsed = Number(value);
            hours = isNaN(parsed) || parsed <= 0 ? 24 : Math.floor(parsed);
        } else if (arg.startsWith("--d=")) {
            const value = arg.slice(4);
            const parsed = Number(value);
            hours = isNaN(parsed) || parsed <= 0 ? 24 : Math.floor(parsed) * 24;
        } else if (arg.startsWith("--span=")) {
            const value = arg.slice(7);
            const parsed = Number(value);
            span = isNaN(parsed) || parsed <= 0 ? 24 : Math.floor(parsed);
        }
    });

    const start = Date.now() - MILLIS_PER_HOUR * hours;
    const end = start + MILLIS_PER_HOUR * span;

    return { start, end };
}

/**
 * Reads a line of input from standard input (stdin) asynchronously.
 *
 * This function displays an optional prompt to the user, then waits for input from stdin.
 * It reads up to 1024 bytes of data, decodes it as UTF-8 text, and returns the trimmed result.
 * If the input stream is closed or no data is available, an empty string is returned.
 *
 * @param prompt - An optional string to display as a prompt before reading input. Defaults to an empty string.
 * @returns A promise that resolves to the trimmed string read from stdin, or an empty string if no input is available.
 */
async function readLine(prompt: string = ""): Promise<string> {
    if (prompt) {
        console.log(prompt);
    }

    const buf = new Uint8Array(1024);
    const n = await Deno.stdin.read(buf);

    if (n === null) {
        return "";
    }

    return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

/**
 * Handles and logs errors in a structured format for the LogWatcher tool.
 *
 * This function provides comprehensive error logging by checking if the error is an
 * instance of the Error class and logging its message, stack trace, and cause if available.
 * For non-Error objects, it converts them to a string representation for logging.
 *
 * @param err - The error object to be handled. Can be of any type (Error instance or other).
 * @returns This function does not return a value (void). It only logs error information to the console.
 */
function errorHandler(err: unknown): void {
    if (err instanceof Error) {
        console.error(`LogWatcher: ${err.message}`);
        if (err.stack) {
            console.error(`Stack trace: ${err.stack}`);
        }
        if (err.cause) {
            console.error(`Caused by: ${err.cause}`);
        }
    } else {
        console.error(`Unknown error in LogWatcher: ${String(err)}`);
    }
}

// Execute the main function and handle any uncaught errors
main().catch((err) => {
  console.error("Failed to start application:", err);
  Deno.exit(1);
});
