import { NetFetch } from '../Net/NetFetch.js';
import {
    TransitionPlanSchema,
    type MixPlanBody,
    type TrackRef,
    type TransitionPlan,
    type TransitionStyle,
} from '@headbangbear/schemas';

export class MixApi {

    public static async plan(
        from: TrackRef,
        to: TrackRef,
        style?: TransitionStyle,
    ): Promise<TransitionPlan> {
        const body: MixPlanBody = { from: from, to: to };
        if (style !== undefined) {
            body.style = style;
        }
        return NetFetch.postData('api/v1/mix/plan', body, TransitionPlanSchema);
    }

}