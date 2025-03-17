/**
 * Tracking utility module for retrieving shipment location information
 * from various carriers using their tracking IDs.
 *
 * @author samshdn
 * @version 0.1.1
 * @date 2025-02-28
 */

import { Sfex } from "./carriers/sfex.ts";
import { Fedex } from "./carriers/fedex.ts";
import { Entity, TrackingID } from "./model.ts";

/**
 * Asynchronously retrieves the location information for a given tracking ID.
 * Supports different carriers (SF Express and FedEx) and handles their specific implementations.
 *
 * @param {TrackingID} trackingID - The tracking identifier containing carrier and tracking number
 * @param {Record<string, string>} extraParams - Additional parameters for SF Express tracking requests
 * @param {string} updateMethod - The method to use for updating tracking information
 * @returns {Promise<Entity | undefined>} A promise that resolves to the tracking entity or undefined if carrier is not supported
 * @async
 */
export async function requestWhereIs(
    trackingID: TrackingID,
    extraParams: Record<string, string>,
    updateMethod: string,
): Promise<Entity | undefined> {
    const trackingNum = trackingID.trackingNum;
    switch (trackingID.carrier) {
        case "sfex":
            return await Sfex.whereIs(
                trackingNum,
                extraParams,
                updateMethod,
            );
        case "fdx":
            return await Fedex.whereIs(trackingNum, updateMethod);
    }
    return undefined;
}
