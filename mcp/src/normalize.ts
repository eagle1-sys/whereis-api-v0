/**
 * @file normalize.ts
 * @description Converts raw Whereis API JSON into stable, model-friendly shapes.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import {
  compact,
  getBoolean,
  getNumber,
  getString,
  getStringArray,
  isRecord,
} from "./coerce.ts";
import type {
  NormalizedEvent,
  OperatorInfo,
  PushResult,
  StatusResult,
  TrackResult,
} from "./types.ts";
import type { NormalizedTrackingId } from "./tracking-id.ts";

function eventTime(event: Record<string, unknown>): number {
  const when = getString(event, "when");
  if (when === undefined) return 0;
  const parsed = Date.parse(when);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeEvent(raw: Record<string, unknown>): NormalizedEvent {
  const additional = isRecord(raw.additional) ? raw.additional : {};
  return compact({
    status: getNumber(raw, "status") ?? -1,
    what: getString(raw, "what") ?? "Unknown status",
    whom: getString(raw, "whom"),
    when: getString(raw, "when"),
    where: getString(raw, "where"),
    notes: getString(raw, "notes"),
    trackingNum: getString(additional, "trackingNum"),
    dataProvider: getString(additional, "dataProvider"),
    updateMethod: getString(additional, "updateMethod"),
    updatedAt: getString(additional, "updatedAt"),
    exceptionCode: getNumber(additional, "exceptionCode"),
    exceptionDesc: getString(additional, "exceptionDesc"),
    transitMode: getString(additional, "transitMode"),
  });
}

/** Builds a TrackResult from the `/v0/whereis/{id}` response. */
export function normalizeTrack(
  raw: unknown,
  trackingId: NormalizedTrackingId,
  maxEvents: number,
): TrackResult {
  const root = isRecord(raw) ? raw : {};
  const entity = isRecord(root.entity) ? root.entity : {};
  const additional = isRecord(entity.additional) ? entity.additional : {};
  const rawEvents = Array.isArray(root.events)
    ? root.events.filter(isRecord)
    : [];

  const sorted = [...rawEvents].sort((a, b) => eventTime(a) - eventTime(b));
  const eventCount = sorted.length;
  const kept = sorted.length > maxEvents ? sorted.slice(-maxEvents) : sorted;

  return compact({
    id: getString(entity, "id") ?? trackingId.id,
    operator: trackingId.operator,
    trackingNumber: trackingId.trackingNumber,
    type: getString(entity, "type"),
    uuid: getString(entity, "uuid"),
    createdAt: getString(entity, "createdAt"),
    origin: getString(additional, "origin"),
    destination: getString(additional, "destination"),
    isCrossBorder: getBoolean(additional, "isCrossBorder"),
    processingTimeMs: getNumber(additional, "processingTimeMs"),
    eventCount,
    returnedEventCount: kept.length,
    truncated: kept.length < eventCount,
    omittedEventCount: eventCount - kept.length,
    events: kept.map(normalizeEvent),
  });
}

/** Builds a StatusResult from the `/v0/status/{id}` response. */
export function normalizeStatus(
  raw: unknown,
  trackingId: NormalizedTrackingId,
): StatusResult {
  const record = isRecord(raw) ? raw : {};
  return compact({
    id: getString(record, "id") ?? trackingId.id,
    status: getNumber(record, "status") ?? -1,
    what: getString(record, "what") ?? "Unknown status",
    whom: getString(record, "whom"),
    when: getString(record, "when"),
    where: getString(record, "where"),
    notes: getString(record, "notes"),
  });
}

/** Builds the operator list from the `/v0/operators` response. */
export function normalizeOperators(raw: unknown): OperatorInfo[] {
  const root = isRecord(raw) ? raw : {};
  const values = Array.isArray(root.operators) ? root.operators : [];

  return values
    .filter(isRecord)
    .map((value) => ({
      code: getString(value, "code") ?? "",
      name: getString(value, "name") ?? "",
      active: getBoolean(value, "active") ?? false,
    }))
    .filter((value) => value.code.length > 0);
}

/** Builds the push summary from the `/v0/push/eg1` response. */
export function normalizePush(raw: unknown): PushResult {
  const record = isRecord(raw) ? raw : {};
  return {
    eventsReceived: getNumber(record, "eventsReceived") ?? 0,
    eventsAdded: getNumber(record, "eventsAdded") ?? 0,
    eventsDuplicate: getNumber(record, "eventsDuplicate") ?? 0,
    createdTrackingIds: getStringArray(record, "createdTrackingIds"),
    updatedTrackingIds: getStringArray(record, "updatedTrackingIds"),
    unchangedTrackingIds: getStringArray(record, "unchangedTrackingIds"),
    failedTrackingIds: getStringArray(record, "failedTrackingIds"),
  };
}
