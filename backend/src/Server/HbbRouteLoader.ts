import { HttpRouteLoader, type IDefaultRoute } from 'figtree';
import { FfmpegTranscoder } from '../Audio/FfmpegTranscoder.js';
import { LibraryService } from './LibraryService.js';
import { AudioRoute } from './Routes/AudioRoute.js';
import { DisableTrackRoute } from './Routes/DisableTrackRoute.js';
import { DjSetPlanStatusRoute } from './Routes/DjSetPlanStatusRoute.js';
import { DjSetPrefetchRoute } from './Routes/DjSetPrefetchRoute.js';
import { DjSetRoute } from './Routes/DjSetRoute.js';
import { SettingsStore } from '../Settings/SettingsStore.js';
import { KeyLabelsRoute } from './Routes/KeyLabelsRoute.js';
import { KeyProfileSweepRoute } from './Routes/KeyProfileSweepRoute.js';
import { LibraryCoverRoute } from './Routes/LibraryCoverRoute.js';
import { LibraryRoute } from './Routes/LibraryRoute.js';
import { MixPlanRoute } from './Routes/MixPlanRoute.js';
import { SettingsRoute } from './Routes/SettingsRoute.js';
import { TracksCompatibleRoute } from './Routes/TracksCompatibleRoute.js';
import { TranscodeRoute } from './Routes/TranscodeRoute.js';

/**
 * Tells figtree's `HttpService` which routes to mount. Every route that needs
 * track data goes through `LibraryService` directly — the multi-provider service
 * dispatches per-track operations (audio, cover, mix-plan-by-ref, etc.) by
 * `providerId`, so the routes don't pick a single library at construction time.
 */
export class HbbRouteLoader extends HttpRouteLoader {
    public static override async loadRoutes(): Promise<IDefaultRoute[]> {
        const service: LibraryService = LibraryService.getInstance();
        return [
            new LibraryRoute(service),
            new TracksCompatibleRoute(service),
            new MixPlanRoute(service),
            new DjSetRoute(service),
            new DjSetPlanStatusRoute(),
            new DjSetPrefetchRoute(service),
            new DisableTrackRoute(service),
            new AudioRoute(service),
            new LibraryCoverRoute(service),
            new KeyLabelsRoute(service),
            new KeyProfileSweepRoute(service),
            new SettingsRoute(SettingsStore.getInstance()),
            new TranscodeRoute(new FfmpegTranscoder()),
        ];
    }
}