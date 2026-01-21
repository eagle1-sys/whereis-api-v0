/**
 * @file watcher.ts
 * @description Interactive command-line tool for querying and analyzing application logs from Grafana.
 *
 * This utility provides a REPL (Read-Eval-Print Loop) interface for developers to interactively
 * query logs stored in Grafana.
 */
import { Grafana } from "./grafana.ts";
import { loadEnv } from "../main/app.ts";
import {loadJSONFromFs} from "./util.ts";
import {checkStatusViaRequesty, checkStatusViaGemini} from "./llm.ts";

let aiModel: string = "gemini";
const MILLIS_PER_HOUR = 60 * 60 * 1000;

let jsonStatusCode: Record<string, unknown> = {};

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

    // load status codes
    await loadStatusCodes();

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
                    console.log("  check   - Check tracking status (usage: check <operator> <trackingNum> [phoneNum])");
                    console.log("  aicheck - AI-powered tracking check (usage: aicheck <operator> <trackingNum> [phoneNum])");
                    console.log("  exit    - Exit the program");
                    console.log();
                    break;

                case "log": {
                    await analyseLog(parts.slice(1));
                    break;
                }

                case "check": {
                    // eg: check sfex SF3182998070266 6993
                    if (parts.length < 3) {
                        console.log("Usage: check <operator> <trackingNum> [phoneNum]");
                        break;
                    }
                    await check(parts[1], parts[2], parts.length >= 4 ? parts[3] : undefined);
                    break;
                }

                case "aicheck": {
                    // eg: aicheck sfex SF3182998070266 6993
                    if (parts.length < 3) {
                        console.log("Usage: aicheck <operator> <trackingNum> [phoneNum]");
                        break;
                    }
                    const operator = parts[1];
                    const trackingNum = parts[2];
                    const phoneNum = parts.length >= 4? parts[3] : undefined;
                    const data = await loadEvents(operator, trackingNum, phoneNum);
                    if (aiModel === "gemini") {
                        await checkStatusViaGemini(data, jsonStatusCode);
                    } else {
                        await checkStatusViaRequesty(data, jsonStatusCode);
                    }
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

async function loadStatusCodes(): Promise<void> {
    try {
        jsonStatusCode = await loadJSONFromFs("./metadata/status-codes.jsonc");
    } catch (error) {
        console.error("Failed to load status codes:", error instanceof Error ? error.message : error);
        Deno.exit(1);
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
    const options = getOptionsFromArgs(args);

    // step 2: initialize Grafana instance
    const grafana = Grafana.getInstance();

    // step 3: query logs from Grafana within the specified time range
    const logs:Record<string, unknown> | undefined = await grafana.queryLog(options);

    if (!logs) {
        console.error("Failed to retrieve logs from Grafana");
        return;
    }

    // const result = logs["data"]["result"];
    const data = logs["data"] as Record<string, unknown>;
    const result = data["result"];

    if (!Array.isArray(result) || result.length === 0) {
        console.info("No log returned from Grafana");
        return;
    }

    // step 4: extract log messages and convert them for future processing
    const values = result[0]["values"];
    const messages = getLogMessages(values)

    // todo: step 5: analyse the logs
    console.log(JSON.stringify(messages, null, 2));
    // ...
}

function getOptionsFromArgs(args: string[]): Record<string, unknown> {
    const result = {
        level: "error",
        start: 0,
        end: 0,
        keyword: ""
    };

    let hours = 24, offset: number = 24;
    let levelSet = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        // Check if this is the first argument and it's not a flag - treat it as log level
        if (i === 0 && !arg.startsWith("--")) {
            result.level = arg.toUpperCase();
            levelSet = true;
            continue;
        }

        if (arg === "--from" && i + 1 < args.length) {
            const value = args[i + 1];
            if (value.startsWith("h")) {
                const parsed = Number(value.substring(1));
                hours = isNaN(parsed) || parsed <= 0 ? 24 : Math.floor(parsed);
            } else if (value.startsWith("d")) {
                const parsed = Number(value.substring(1));
                hours = isNaN(parsed) || parsed <= 0 ? 24 : Math.floor(parsed) * 24;
            }
            i++;
        } else if (arg === "--offset" && i + 1 < args.length) {
            const parsed = Number(args[i + 1]);
            offset = isNaN(parsed) || parsed <= 0 ? 24 : Math.floor(parsed);
            i++;
        } else if (!arg.startsWith("--") && levelSet) {
            // This is a non-flag argument after the level has been set - treat it as keyword
            result.keyword = arg;
        }
    }

    result.start = Date.now() - MILLIS_PER_HOUR * hours;
    result.end = Math.min(result.start + MILLIS_PER_HOUR * offset, Date.now());

    return result;
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
        await Deno.stdout.write(new TextEncoder().encode(prompt));
    }

    const buf = new Uint8Array(1024);
    const n = await Deno.stdin.read(buf);

    if (n === null) {
        return "";
    }

    return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

function getLogMessages(logData: Array<[string, string]>): Array<{ time: string; message: string }> {
    const formattedLogs: Array<{ time: string; message: string }> = [];

    for (const entry of logData) {
        if (!Array.isArray(entry)) {
            continue;
        }
        const timestampNs = entry[0];
        const logJson = entry[1];
        // Convert nanosecond timestamp to milliseconds
        const timestampMs = Math.floor(Number(timestampNs) / 1000000);
        const isoTime = new Date(timestampMs).toISOString();

        // Parse the JSON string to extract the message
        try {
            const logObject = JSON.parse(logJson);
            const message = logObject.message || logJson;

            formattedLogs.push({
                time: isoTime,
                message: message
            });
        } catch {
            // If JSON parsing fails, use the raw string
            formattedLogs.push({
                time: isoTime,
                message: logJson
            });
        }
    }

    return formattedLogs;
}


async function check(operator: string, trackingNum: string, phoneNum?:string): Promise<void> {
    const trackingId = operator + "-" + trackingNum;
    try {
        const events = await loadEvents(operator, trackingNum, phoneNum);

        // Optionally analyze the events
        checkMissingStatusByRule(trackingId, events);
    } catch (error) {
        console.error(`Error loading data for ${trackingId}:`, error instanceof Error ? error.message : error);
    }
}

function checkMissingStatusByRule(trackingId: string, data: Array<Record<string, unknown>>): void {
    // Sort data by output.when attribute
    const sortedData = [...data].sort((a, b) => {
        const outputA = a.output as Record<string, unknown>;
        const outputB = b.output as Record<string, unknown>;
        const whenA = outputA.when as string;
        const whenB = outputB.when as string;
        return whenA.localeCompare(whenB);
    });

    // Define major event codes
    const majorEventCodes = [3000, 3100, 3200, 3300, 3400, 3500];

    // Extract status codes from sorted data
    const existingStatuses = new Set<number>();
    for (const item of sortedData) {
        const output = item.output as Record<string, unknown>;
        const status = output.status as number;
        existingStatuses.add(status);
    }

    // Check for missing major events
    const missingStatuses: number[] = [];
    for (const majorCode of majorEventCodes) {
        if (!existingStatuses.has(majorCode)) {
            missingStatuses.push(majorCode);
        }
    }

    // Print results
    console.log(`=== Status Check Results for trackingID ${trackingId} ===`);
    if (missingStatuses.length > 0) {
        console.log(`Missing major events: ${missingStatuses.join(", ")}`);
        for (const code of missingStatuses) {
            const statusInfo = jsonStatusCode[code];
            if (statusInfo) {
                console.log(`   - ${code}: ${statusInfo}`);
            }
        }
    } else {
        console.log("All major events are present");
    }
    console.log("===========================\n");
}


async function loadEvents(operator: string, trackingNum: string, phoneNum?:string): Promise<Array<Record<string, unknown>>> {
    let events: Array<Record<string, unknown>> = [];
    const trackingId = operator + "-" + trackingNum;
    try {
        console.log(`Loading data for tracking: ${trackingId}`);
        const extra: { [key: string]: string | undefined } = {fulldata: "true"};
        if (phoneNum) {
            extra['phonenum'] = phoneNum;
        }
        const waybillData = await loadTrackingDataFromWhereis(trackingId, extra);
        events = convertWaybill(operator, waybillData);
        console.log(`Loaded ${events.length} events for ${trackingId}`);
    } catch (error) {
        console.error(`Error loading data for ${trackingId}:`, error instanceof Error ? error.message : error);
    }
    return events;
}

async function loadTrackingDataFromWhereis(trackingId: string, extra: {[key: string]: string | undefined}): Promise<Record<string, unknown>> {
    const WHEREIS_API_URL = Deno.env.get("WHEREIS_API_URL");
    let url = `${WHEREIS_API_URL}/v0/whereis/${trackingId}`;
    if (extra !== undefined) {
        const params = new URLSearchParams(extra as Record<string, string>);
        url = url + "?" + params.toString();
    }

    // issue http request
    const apiKey = Deno.env.get("WHEREIS_API_KEY");
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
        },
    });

    if (!response.ok) {
        throw new Error(`WhereIs API error: ${response.status} ${response.statusText}`);
    }

    return  await response.json();
}

function convertWaybill(operatorCode: string, waybill: Record<string, unknown>): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    const events = waybill.events as Array<Record<string, unknown>>;
    if (!events || !Array.isArray(events)) {
        return result;
    }

    for (const event of events) {
        const sourceData = event.sourceData as Record<string, unknown>;

        if (!sourceData) {
            continue;
        }

        let input: Record<string, unknown>;
        if (operatorCode === "sfex") {
            input = {
                firstStatusCode: sourceData.firstStatusCode,
                firstStatusName: sourceData.firstStatusName,
                secondaryStatusCode: sourceData.secondaryStatusCode,
                secondaryStatusName: sourceData.secondaryStatusName,
                date: sourceData.acceptTime,
                remark: sourceData.remark,
            };
        } else if (operatorCode === "fdx") {
            input = {
                eventType: sourceData.eventType,
                eventDescription: sourceData.eventDescription,
                derivedStatusCode: sourceData.derivedStatusCode,
                derivedStatus: sourceData.derivedStatus,
                date: sourceData.date,
            };
        } else {
            // Default fallback for unknown operators
            input = sourceData;
        }

        result.push({
            input: input,
            output: {
                status: event.status,
                what: event.what,
                when: event.when,
            },
        });
    }

    return result;
}

// Execute the main function and handle any uncaught errors
main().catch((err) => {
  console.error("Failed to start application:", err);
  Deno.exit(1);
});