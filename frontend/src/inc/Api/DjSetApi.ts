import { NetFetch } from '../Net/NetFetch.js';
import { DjSetSchema, type DjSet, type DjSetBody } from '@headbangbear/schemas';

export class DjSetApi {

    public static async plan(request: DjSetBody = {}): Promise<DjSet> {
        return NetFetch.postData('api/v1/dj-set/plan', request, DjSetSchema);
    }

}