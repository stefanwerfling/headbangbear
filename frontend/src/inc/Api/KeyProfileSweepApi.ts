import { NetFetch } from '../Net/NetFetch.js';
import {
    KeyProfileSweepReportSchema,
    type KeyProfileSweepBody,
    type KeyProfileSweepReport,
} from '@headbangbear/schemas';

/**
 * Wrapper around `POST /api/v1/library/profile-sweep`. Single endpoint — the backend has
 * no separate "list profiles" call because the profile names are essentia constants the
 * frontend already knows (mirrored in the page-side `DEFAULT_PROFILES` list).
 */
export class KeyProfileSweepApi {

    public static async run(body: KeyProfileSweepBody): Promise<KeyProfileSweepReport> {
        return NetFetch.postData(
            'api/v1/library/profile-sweep',
            body,
            KeyProfileSweepReportSchema,
        );
    }

}