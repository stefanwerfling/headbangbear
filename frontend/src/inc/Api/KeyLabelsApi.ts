import { NetFetch } from '../Net/NetFetch.js';
import {
    KeyLabelsResponseSchema,
    type KeyLabelsBody,
    type KeyLabelsResponse,
} from '@headbangbear/schemas';

/**
 * Wrapper around the `/api/v1/library/key-labels` endpoint pair (GET + POST). The backend
 * persists ground-truth labels per local provider as a `<rootDir>/truth.json` map; this API
 * surfaces it as a flat array (`{providerId, path, key}` per row) so the frontend can
 * iterate, edit, and POST it back as one transaction.
 */
export class KeyLabelsApi {

    public static async list(providerId: string): Promise<KeyLabelsResponse> {
        const url: string = `api/v1/library/key-labels?providerId=${encodeURIComponent(providerId)}`;
        return NetFetch.getData(url, KeyLabelsResponseSchema);
    }

    public static async save(body: KeyLabelsBody): Promise<KeyLabelsResponse> {
        return NetFetch.postData('api/v1/library/key-labels', body, KeyLabelsResponseSchema);
    }

}