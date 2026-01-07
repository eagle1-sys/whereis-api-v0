// deno-lint-ignore-file require-await
/**
 * @file eg1.ts
 * @description A TypeScript class implementation for interacting with the Eagle1 tracking API.
 *
 * @copyright (c) 2025, the Eagle1 authors
 * @license BSD 3-Clause License
 */

import {Entity, Event, TrackingID,} from "../../main/model.ts";
import {OperatorModule} from "../../main/operator.ts";

/**
 * A class to interact with the Eagle1 tracking API and manage shipment tracking information.
 */
export class Eg1 implements OperatorModule{

    validateStoredEntity(_entity: Entity, _params: Record<string, string>): boolean {
      return true; // Placeholder validation logic
    }
    validateParams(_trackingId: TrackingID, _params: Record<string, string>): boolean {
      return true; // Placeholder validation logic
    }
    getExtraParams(_params: Record<string, string>): Record<string, string> {
      return {}; // Placeholder for extra parameters
    }
    validateTrackingNum(_trackingNum: string): void {
      return; // Placeholder validation logic for tracking number format
    }

    /**
     * Retrieves the current location and tracking details for a given tracking number.
     * @param {TrackingID} _trackingIds - The tracking ID(s) defined by eagle1.
     * @param _extraParams
     * @param {string} _updateMethod - The method used to update the tracking information.
     * @returns {Promise<Entity | undefined>} A promise resolving to the tracking entity or undefined if not found.
     */
    async whereIs(_trackingIds: TrackingID[], _extraParams: Record<string, string>, _updateMethod: string): Promise<Entity[]> {
        throw new Error("eg1 is a push-based operator and does not support whereIs queries");
    }

    /**
     * Creates an array of Entity objects from JSON data.
     *
     * @param {Record<string, unknown>} data - The JSON data object containing an array of entities to be converted.
     * @returns {Promise<{ entities: Entity[], result: Record<string, unknown> }>} A promise that resolves to an object containing:
     *          - `entities`: An array of Entity objects created from the JSON data
     *          - `result`: The response data as a key-value record.
     *
     */
    async fromJSON(data: Record<string, unknown>): Promise<{ entities: Entity[], result: Record<string, unknown> }> {
        const entities: Entity[] = [];
        const result: Record<string, unknown> = { success: true };
        try {
            // Determine if data contains single entity or multiple entities
            let entityDataList: Array<Record<string, unknown>> = [];

            if (data["entities"] && Array.isArray(data["entities"])) {
                // Multiple entities format: { entities: [{ entity: {...}, events: [...] }, ...] }
                entityDataList = data["entities"] as Array<Record<string, unknown>>;
            } else {
                result["success"] = false;
                result["error"] = "Invalid data format: missing entities attribute";
                return { entities, result };
            }

            // Process each entity
            for (const entityItem of entityDataList) {
                const entityData = entityItem["entity"] as Record<string, unknown>;
                const eventsData = entityItem["events"] as Array<Record<string, unknown>>;

                if (!entityData || !eventsData) {
                    continue; // Skip invalid entity items
                }

                // Create a new Entity object
                const entity = new Entity();

                // Populate entity properties from entityData if available
                if (entityData["uuid"]) entity.uuid = entityData["uuid"] as string;
                if (entityData["id"]) entity.id = entityData["id"] as string;
                if (entityData["type"]) entity.type = entityData["type"] as string;
                if (entityData["params"]) entity.params = entityData["params"] as Record<string, string>;
                if (entityData["additional"]) entity.additional = entityData["additional"] as Record<string, unknown>;

                // Process events array
                for (const eventData of eventsData) {
                    const event = new Event();

                    // Map event properties
                    if (eventData["status"]) event.status = eventData["status"] as number;
                    if (eventData["what"]) event.what = eventData["what"] as string;
                    if (eventData["whom"]) event.whom = eventData["whom"] as string;
                    if (eventData["when"]) event.when = eventData["when"] as string;
                    if (eventData["where"]) event.where = eventData["where"] as string;
                    if (eventData["notes"]) event.notes = eventData["notes"] as string;

                    // Handle additional data
                    const additional = eventData["additional"] as Record<string, unknown>;
                    if (additional) {
                        if (additional["trackingNum"]) event.trackingNum = additional["trackingNum"] as string;
                        if (additional["operatorCode"]) event.operatorCode = additional["operatorCode"] as string;
                        if (additional["dataProvider"]) event.dataProvider = additional["dataProvider"] as string;
                        if (additional["exceptionCode"]) event.exceptionCode = additional["exceptionCode"] as number;
                        if (additional["exceptionDesc"]) event.exceptionDesc = additional["exceptionDesc"] as string;

                        // Store updateMethod and updatedAt in additional
                        event.additional = {
                            updateMethod: "push",
                            updatedAt: new Date().toISOString(),
                        };
                    }

                    // Generate eventId if not present
                    if (event.when && event.status && event.trackingNum && event.operatorCode) {
                        const date = new Date(event.when);
                        const secondsSinceEpoch = Math.floor(date.getTime() / 1000);
                        event.eventId = `ev_${event.operatorCode}-${event.trackingNum}-${secondsSinceEpoch}-${event.status}`;
                    }

                    // Set sourceData
                    event.sourceData = (eventData["sourceData"] as Record<string, unknown>) ?? {};

                    // Add event to entity if it doesn't already exist
                    if (event.eventId && !entity.isEventIdExist(event.eventId)) {
                        entity.addEvent(event);
                    }
                }

                // Sort events by when timestamp
                entity.sortEventsByWhen();

                entities.push(entity);
            }

            result["entitiesProcessed"] = entities.length;
        } catch (error) {
            result["success"] = false;
            result["error"] = error instanceof Error ? error.message : "Unknown error occurred";
        }

        return { entities, result };
    }

}

