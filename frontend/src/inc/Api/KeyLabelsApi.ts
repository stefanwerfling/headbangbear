import { NetFetch } from '../Net/NetFetch.js';
import {
    KeyLabelsResponseSchema,
    type KeyLabelsBody,
    type KeyLabelsResponse,
} from '@headbangbear/schemas';

/**
 * Wrapper around the `/api/v1/library/key-labels` endpoint pair (GET + POST). The backend
 * persists ground-truth labels as a `<library>/truth.json` map; this API surfaces it as a
 * flat array so the frontend can iterate, edit, and POST it back as one transaction.
 */
export class KeyLabelsApi {

    public static async list(): Promise<KeyLabelsResponse> {
        return NetFetch.getData('api/v1/library/key-labels', KeyLabelsResponseSchema);
    }

    public static async save(body: KeyLabelsBody): Promise<KeyLabelsResponse> {
        return NetFetch.postData('api/v1/library/key-labels', body, KeyLabelsResponseSchema);
    }

}