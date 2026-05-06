import { NetFetch } from '../Net/NetFetch.js';
import {
    DjSetPlanStatusSchema,
    DjSetPrefetchResponseSchema,
    type DjSetBody,
    type DjSetPlanStatus,
    type DjSetPrefetchBody,
    type DjSetPrefetchResponse,
} from '@headbangbear/schemas';

export class DjSetApi {

    /** Kick off async planning. Returns immediately with the new job status —
     *  caller must poll `planStatus()` until `state === 'done' | 'error'`. */
    public static async plan(request: DjSetBody = {}): Promise<DjSetPlanStatus> {
        return NetFetch.postData('api/v1/dj-set/plan', request, DjSetPlanStatusSchema);
    }

    /** Snapshot of the singleton planning job — `state`, optional `progress`,
     *  `result` once `state === 'done'`, `error` once `state === 'error'`. */
    public static async planStatus(): Promise<DjSetPlanStatus> {
        return NetFetch.getData('api/v1/dj-set/plan-status', DjSetPlanStatusSchema);
    }

    /** Update the rolling DJ-set prefetch window on the backend. Awaiting this
     *  before play starts guarantees the listed tracks are cached locally; the
     *  frontend should fire-and-forget for subsequent track-change updates. */
    public static async prefetch(body: DjSetPrefetchBody): Promise<DjSetPrefetchResponse> {
        return NetFetch.postData('api/v1/dj-set/prefetch', body, DjSetPrefetchResponseSchema);
    }

}