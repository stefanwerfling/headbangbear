import { HttpRouteLoader, type IDefaultRoute } from 'figtree';
import { FfmpegTranscoder } from '../Audio/FfmpegTranscoder.js';
import { LibraryService } from './LibraryService.js';
import { AudioRoute } from './Routes/AudioRoute.js';
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
 * Tells figtree's `HttpService` which routes to mount. All routes that need track data
 * read through `LibraryService` (storage-agnostic facade); `AudioRoute` and
 * `LibraryCoverRoute` go through it as well so binary streaming dispatches between
 * local-fs sendFile and Jellyfin proxy depending on the active source.
 */
export class HbbRouteLoader extends HttpRouteLoader {
    public static override async loadRoutes(): Promise<IDefaultRoute[]> {
        const service: LibraryService = LibraryService.getInstance();
        const library = service.getLibrary();
        return [
            new LibraryRoute(service),
            new TracksCompatibleRoute(library),
            new MixPlanRoute(library),
            new DjSetRoute(library),
            new AudioRoute(service),
            new LibraryCoverRoute(service),
            new KeyLabelsRoute(service),
            new KeyProfileSweepRoute(service),
            new SettingsRoute(SettingsStore.getInstance()),
            new TranscodeRoute(new FfmpegTranscoder()),
        ];
    }
}