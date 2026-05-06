import { NetFetch } from '../Net/NetFetch.js';
import {
    DisableTrackResponseSchema,
    type DisableTrackBody,
    type DisableTrackResponse,
} from '@headbangbear/schemas';

/**
 * Wrapper around per-track endpoints. Currently just the soft-disable toggle
 * used by the deactivate button in the Library / DJ-Set views.
 */
export class TracksApi {

    public static async setDisabled(body: DisableTrackBody): Promise<DisableTrackResponse> {
        return NetFetch.postData('api/v1/tracks/disable', body, DisableTrackResponseSchema);
    }

}