/**
 * @file format.ts
 * @description Renders normalized results as compact text for the model.
 *
 * The text is the primary model-visible output; structuredContent carries the
 * same data for programmatic callers. Keep every event on one line.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import type {
  NormalizedEvent,
  OperatorInfo,
  PushResult,
  StatusResult,
  TrackResult,
} from "./types.ts";

const MAX_SEGMENT_LENGTH = 1_000;

function clean(
  value: string | undefined,
  max = MAX_SEGMENT_LENGTH,
): string | undefined {
  if (value === undefined) return undefined;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return undefined;
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

function formatEvent(event: NormalizedEvent, index: number): string {
  const segments: string[] = [];
  segments.push(event.when ?? "unknown time");
  segments.push(`${event.status} ${clean(event.what) ?? "Unknown status"}`);

  const whom = clean(event.whom, 200);
  if (whom !== undefined) segments.push(whom);

  const where = clean(event.where, 300);
  if (where !== undefined) segments.push(where);

  const notes = clean(event.notes);
  if (notes !== undefined) segments.push(notes);

  return `${index}. ${segments.join(" | ")}`;
}

function formatRoute(result: TrackResult): string | undefined {
  const origin = clean(result.origin, 300);
  const destination = clean(result.destination, 300);
  if (origin === undefined && destination === undefined) return undefined;

  const path = [origin, destination].filter((value): value is string =>
    value !== undefined
  );
  const suffix = result.isCrossBorder === true ? " (cross-border)" : "";
  return `Route: ${path.join(" -> ")}${suffix}`;
}

/** Renders a full tracking timeline. */
export function formatTrack(result: TrackResult): string {
  const lines: string[] = [];
  const latest = result.events.at(-1);
  const latestText = latest === undefined
    ? ""
    : `; latest ${latest.status} ${clean(latest.what) ?? "Unknown status"}${
      latest.when ? ` (${latest.when})` : ""
    }`;

  lines.push(
    `${result.id} — ${result.eventCount} event${
      result.eventCount === 1 ? "" : "s"
    }${latestText}`,
  );

  const route = formatRoute(result);
  if (route !== undefined) lines.push(route);

  if (result.events.length === 0) {
    lines.push("No events reported.");
  } else {
    result.events.forEach((event, index) => {
      lines.push(formatEvent(event, index + 1));
    });
  }

  if (result.truncated) {
    lines.push(
      `… ${result.omittedEventCount} earlier events omitted (showing the most recent ${result.returnedEventCount}). Set WHEREIS_MAX_EVENTS to raise the cap.`,
    );
  }

  return lines.join("\n");
}

/** Renders the latest status. */
export function formatStatus(result: StatusResult): string {
  const lines: string[] = [
    `${result.id} — ${result.status} ${clean(result.what) ?? "Unknown status"}`,
  ];

  const detail: string[] = [];
  const when = clean(result.when, 100);
  const where = clean(result.where, 300);
  const notes = clean(result.notes);
  if (when !== undefined) detail.push(when);
  if (where !== undefined) detail.push(where);
  if (notes !== undefined) detail.push(notes);
  if (detail.length > 0) lines.push(detail.join(" | "));

  return lines.join("\n");
}

/** Renders the operator list. */
export function formatOperators(operators: OperatorInfo[]): string {
  if (operators.length === 0) return "No operators returned.";
  return operators
    .map(
      (operator) =>
        `- ${operator.code}: ${operator.name} (${
          operator.active ? "active" : "inactive"
        })`,
    )
    .join("\n");
}

/** Renders the push summary. */
export function formatPush(result: PushResult): string {
  const lines: string[] = [
    `Received ${result.eventsReceived} event${
      result.eventsReceived === 1 ? "" : "s"
    }: ${result.eventsAdded} added, ${result.eventsDuplicate} duplicate.`,
  ];

  if (result.createdTrackingIds.length > 0) {
    lines.push(`Created: ${result.createdTrackingIds.join(", ")}`);
  }
  if (result.updatedTrackingIds.length > 0) {
    lines.push(`Updated: ${result.updatedTrackingIds.join(", ")}`);
  }
  if (result.unchangedTrackingIds.length > 0) {
    lines.push(`Unchanged: ${result.unchangedTrackingIds.join(", ")}`);
  }
  if (result.failedTrackingIds.length > 0) {
    lines.push(`Failed: ${result.failedTrackingIds.join(", ")}`);
  }

  return lines.join("\n");
}
