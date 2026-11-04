/**
 * @file tracking-id.ts
 * @description Normalizes and validates the `<operator>-<tracking_number>` format.
 *
 * The HTTP API splits the tracking ID on "-" and ignores extra segments, so the
 * MCP server rejects anything that does not have exactly one hyphen.
 *
 * @copyright (c) 2026, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import { inputError } from "./errors.ts";

/** A validated tracking ID plus the optional SF Express phone parameter. */
export interface NormalizedTrackingId {
  operator: string;
  trackingNumber: string;
  /** Canonical `<operator>-<tracking_number>` string. */
  id: string;
  /** Last four digits of the recipient phone; only for SF Express. */
  phoneLast4?: string;
}

const TRACKING_ID_PATTERN = /^([A-Za-z0-9]+)-([A-Za-z0-9_.]+)$/;
const SFEX_TRACKING_NUMBER_PATTERN = /^SF\d{13}$/;
const PHONE_LAST4_PATTERN = /^\d{4}$/;
const FDX_MAX_TRACKING_NUMBER_LENGTH = 25;

function normalizePhone(
  phone: string | number | undefined,
): string | undefined {
  if (phone === undefined) return undefined;
  if (typeof phone === "number") {
    if (!Number.isInteger(phone) || phone < 0) {
      throw inputError(
        "phone_last4 must be the last four digits of the recipient's phone number.",
        'Pass a four-digit string such as "6993" so leading zeros are preserved.',
      );
    }
    return String(phone);
  }
  const trimmedPhone = phone.trim();
  return trimmedPhone.length === 0 ? undefined : trimmedPhone;
}

/**
 * Validates a tracking ID and applies operator-specific rules.
 *
 * @throws {WhereisError} with code "INPUT" when the ID or phone is invalid.
 */
export function normalizeTrackingId(
  raw: string,
  phoneLast4?: string | number,
): NormalizedTrackingId {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw inputError(
      "A tracking ID is required.",
      "Pass a tracking ID in `<operator>-<tracking_number>` form, e.g. `fdx-888877776666`.",
    );
  }

  const match = TRACKING_ID_PATTERN.exec(trimmed);
  if (!match) {
    const hyphenCount = (trimmed.match(/-/g) ?? []).length;
    const hint = hyphenCount > 1
      ? "Use exactly one hyphen: the operator code, one hyphen, then the tracking number. Extra hyphens are rejected to avoid silent truncation."
      : "Use `<operator>-<tracking_number>`, e.g. `fdx-888877776666` or `sfex-SF1234123412341`. Whitespace, spaces, and slashes are not allowed.";
    throw inputError(`Invalid tracking ID "${trimmed}".`, hint);
  }

  const operator = match[1].toLowerCase();
  let trackingNumber = match[2];
  const phone = normalizePhone(phoneLast4);

  if (operator === "fdx") {
    if (trackingNumber.length > FDX_MAX_TRACKING_NUMBER_LENGTH) {
      throw inputError(
        `FedEx tracking numbers may not exceed ${FDX_MAX_TRACKING_NUMBER_LENGTH} characters.`,
        "Check the tracking number and try again.",
      );
    }
    if (phone !== undefined) {
      throw inputError(
        "phone_last4 is only used for SF Express (`sfex`).",
        "Omit phone_last4 for FedEx shipments.",
      );
    }
  }

  if (operator === "sfex") {
    trackingNumber = trackingNumber.toUpperCase();
    if (!SFEX_TRACKING_NUMBER_PATTERN.test(trackingNumber)) {
      throw inputError(
        `Invalid SF Express tracking number "${trackingNumber}".`,
        "SF Express tracking numbers are `SF` followed by 13 digits, e.g. `SF1234123412341`.",
      );
    }
    if (phone === undefined || phone.length === 0) {
      throw inputError(
        "SF Express requires phone_last4.",
        'Pass the last 4 digits of the recipient\'s phone number as phone_last4, e.g. "6993".',
      );
    }
    if (!PHONE_LAST4_PATTERN.test(phone)) {
      throw inputError(
        `Invalid phone_last4 "${phone}".`,
        'phone_last4 must be exactly four digits, e.g. "6993".',
      );
    }
  }

  if (operator === "eg1" && phone !== undefined) {
    throw inputError(
      "phone_last4 is only used for SF Express (`sfex`).",
      "Omit phone_last4 for Eagle1 (`eg1`) shipments.",
    );
  }

  return {
    operator,
    trackingNumber,
    id: `${operator}-${trackingNumber}`,
    phoneLast4: operator === "sfex" ? phone : undefined,
  };
}
