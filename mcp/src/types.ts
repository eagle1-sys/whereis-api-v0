/**
 * @file types.ts
 * @description Normalized shapes used by the MCP tools and formatters.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

/** One normalized shipment event. */
export interface NormalizedEvent {
  status: number;
  what: string;
  whom?: string;
  when?: string;
  where?: string;
  notes?: string;
  trackingNum?: string;
  dataProvider?: string;
  updateMethod?: string;
  updatedAt?: string;
  exceptionCode?: number;
  exceptionDesc?: string;
  transitMode?: string;
}

/** The normalized result of a full tracking lookup. */
export interface TrackResult {
  id: string;
  operator: string;
  trackingNumber: string;
  type?: string;
  uuid?: string;
  createdAt?: string;
  origin?: string;
  destination?: string;
  isCrossBorder?: boolean;
  processingTimeMs?: number;
  eventCount: number;
  returnedEventCount: number;
  truncated: boolean;
  omittedEventCount: number;
  events: NormalizedEvent[];
}

/** The normalized result of a latest-status lookup. */
export interface StatusResult {
  id: string;
  status: number;
  what: string;
  whom?: string;
  when?: string;
  where?: string;
  notes?: string;
}

/** One carrier operator returned by `/v0/operators`. */
export interface OperatorInfo {
  code: string;
  name: string;
  active: boolean;
}

/** One event accepted by the Eagle1 push API. */
export interface PushEventInput {
  trackingNum: string;
  status: number;
  what: string;
  whom: string;
  when: string;
  where: string;
  notes?: string;
}

/** Counts returned by the Eagle1 push API. */
export interface PushResult {
  eventsReceived: number;
  eventsAdded: number;
  eventsDuplicate: number;
  createdTrackingIds: string[];
  updatedTrackingIds: string[];
  unchangedTrackingIds: string[];
  failedTrackingIds: string[];
}
