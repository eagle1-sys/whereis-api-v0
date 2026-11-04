/**
 * @file mock-backend.ts
 * @description Canned Whereis backend for tool and transport tests.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import type {
  OperatorInfo,
  PushResult,
  StatusResult,
  TrackResult,
} from "../src/types.ts";
import type { WhereisBackend } from "../src/whereis-client.ts";

export const SAMPLE_TRACK: TrackResult = {
  id: "fdx-888877776666",
  operator: "fdx",
  trackingNumber: "888877776666",
  type: "waybill",
  uuid: "01931cdf-2b80-74e2-8924-d2e5a7b6c3f1",
  createdAt: "2024-11-11T14:16:48-06:00",
  origin: "San Francisco CA United States",
  destination: "CENTRAL Hong Kong SAR, China",
  isCrossBorder: true,
  eventCount: 2,
  returnedEventCount: 2,
  truncated: false,
  omittedEventCount: 0,
  events: [
    {
      status: 3000,
      what: "Transport Bill Created",
      whom: "FedEx",
      when: "2024-11-11T14:16:48-06:00",
      where: "Customer location",
      notes: "Shipment information sent to FedEx",
      trackingNum: "888877776666",
      dataProvider: "FedEx",
      updateMethod: "manual-pull",
      updatedAt: "2025-02-20T12:23:43.892Z",
    },
    {
      status: 3500,
      what: "Delivered",
      whom: "FedEx",
      when: "2024-11-17T10:12:00-06:00",
      where: "Front door",
      trackingNum: "888877776666",
      dataProvider: "FedEx",
      updateMethod: "manual-pull",
      updatedAt: "2025-02-20T12:23:43.892Z",
    },
  ],
};

export const SAMPLE_STATUS: StatusResult = {
  id: "fdx-888877776666",
  status: 3500,
  what: "Delivered",
  whom: "FedEx",
  when: "2024-11-17T10:12:00-06:00",
  where: "Front door",
  notes: "Signed by J. D.",
};

export const SAMPLE_OPERATORS: OperatorInfo[] = [
  { code: "fdx", name: "FedEx", active: true },
  { code: "sfex", name: "SF Express", active: true },
  { code: "eg1", name: "Eagle1", active: true },
];

export const SAMPLE_PUSH: PushResult = {
  eventsReceived: 2,
  eventsAdded: 1,
  eventsDuplicate: 1,
  createdTrackingIds: ["eg1-ACME11112222"],
  updatedTrackingIds: [],
  unchangedTrackingIds: ["eg1-ACME33334444"],
  failedTrackingIds: [],
};

/** Builds a mock backend with optional overrides. */
export function createMockBackend(
  overrides: Partial<WhereisBackend> = {},
): WhereisBackend {
  const base: WhereisBackend = {
    listOperators: () => Promise.resolve(SAMPLE_OPERATORS),
    getLatestStatus: () => Promise.resolve(SAMPLE_STATUS),
    trackShipment: () => Promise.resolve(SAMPLE_TRACK),
    pushEvents: () => Promise.resolve(SAMPLE_PUSH),
  };

  return { ...base, ...overrides };
}
