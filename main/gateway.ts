/**
 * @file gateway.ts
 * @description utility module for retrieving shipment location information
 * from various carriers using their tracking IDs.
  */

import { Sfex } from "../operators/sfex.ts";
import { Fdx } from "../operators/fdx.ts";
import { Entity, TrackingID } from "./model.ts";

/**
 * Asynchronously retrieves the location information for a given tracking ID.
 * Supports different carriers (SF Express and FedEx) and handles their specific implementations.
 *
 * @param {TrackingID} trackingId - The tracking identifier containing carrier and tracking number
 * @param {Record<string, string>} extraParams - Additional parameters for SF Express tracking requests
 * @param {string} updateMethod - The method to use for updating tracking information
 * @returns {Promise<Entity | undefined>} A promise that resolves to the tracking entity or undefined if carrier is not supported
 * @async
 */
export async function requestWhereIs(
    trackingId: TrackingID,
    extraParams: Record<string, string>,
    updateMethod: string,
): Promise<Entity | undefined> {
    let entity: Entity | undefined;
    switch (trackingId.operator) {
        case "sfex":
            entity = await Sfex.whereIs(
                trackingId,
                extraParams,
                updateMethod,
            );
            break;
        case "fdx":
            entity = await Fdx.whereIs(trackingId, updateMethod);
            break
    }
    if(entity!==undefined) {

    }
    return entity;
}


