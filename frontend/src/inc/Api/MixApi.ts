import { NetFetch } from '../Net/NetFetch.js';
import {
    TransitionPlanSchema,
    type TransitionPlan,
    type TransitionStyle
} from '@headbangbear/schemas';

export class MixApi {

    public static async plan(
        fromPath: string,
        toPath: string,
        style?: TransitionStyle
    ): Promise<TransitionPlan> {
        const body: { fromPath: string; toPath: string; style?: TransitionStyle } = {
            fromPath: fromPath,
            toPath: toPath
        };
        if (style !== undefined) {
            body.style = style;
        }
        return NetFetch.postData('api/v1/mix/plan', body, TransitionPlanSchema);
    }

}