import { NetFetch } from '../Net/NetFetch.js';
import {
    JellyfinTestResultSchema,
    SettingsSchema,
    type JellyfinTestBody,
    type JellyfinTestResult,
    type Settings,
    type SettingsBody,
} from '@headbangbear/schemas';

/**
 * Wrapper around `/api/v1/settings/*`. Three endpoints — read, write, and a separate
 * Jellyfin connection probe that does *not* persist. Test before save is the explicit
 * UX so a typo can't overwrite working credentials.
 */
export class SettingsApi {

    public static async get(): Promise<Settings> {
        return NetFetch.getData('api/v1/settings/state', SettingsSchema);
    }

    public static async save(body: SettingsBody): Promise<Settings> {
        return NetFetch.postData('api/v1/settings/state', body, SettingsSchema);
    }

    public static async testJellyfin(body: JellyfinTestBody): Promise<JellyfinTestResult> {
        return NetFetch.postData(
            'api/v1/settings/jellyfin-test',
            body,
            JellyfinTestResultSchema,
        );
    }

}