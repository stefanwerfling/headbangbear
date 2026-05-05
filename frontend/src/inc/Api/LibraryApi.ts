import { NetFetch } from '../Net/NetFetch.js';
import {
    CompatibleResponseSchema,
    LibraryResponseSchema,
    ScanStatusSchema,
    type CompatibleResponse,
    type LibraryResponse,
    type ScanStatus,
} from '@headbangbear/schemas';

/**
 * Wrapper around the `/api/v1/library/*` and `/api/v1/tracks/compatible` endpoints.
 */
export class LibraryApi {

    public static async list(): Promise<LibraryResponse> {
        return NetFetch.getData('api/v1/library/list', LibraryResponseSchema);
    }

    public static async rescan(): Promise<LibraryResponse> {
        return NetFetch.postData('api/v1/library/rescan', {}, LibraryResponseSchema);
    }

    public static async compatible(trackPath: string): Promise<CompatibleResponse> {
        const url: string = `api/v1/tracks/compatible?path=${encodeURIComponent(trackPath)}`;
        return NetFetch.getData(url, CompatibleResponseSchema);
    }

    public static async scanStatus(): Promise<ScanStatus> {
        return NetFetch.getData('api/v1/library/scan-status', ScanStatusSchema);
    }

}