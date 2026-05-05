import { HttpRouteLoader, type IDefaultRoute } from 'figtree';
import { FfmpegTranscoder } from '../Audio/FfmpegTranscoder.js';
import { LibraryService } from './LibraryService.js';
import { AudioRoute } from './Routes/AudioRoute.js';
import { DjSetRoute } from './Routes/DjSetRoute.js';
import { KeyLabelsRoute } from './Routes/KeyLabelsRoute.js';
import { KeyProfileSweepRoute } from './Routes/KeyProfileSweepRoute.js';
import { LibraryCoverRoute } from './Routes/LibraryCoverRoute.js';
import { LibraryRoute } from './Routes/LibraryRoute.js';
import { MixPlanRoute } from './Routes/MixPlanRoute.js';
import { TracksCompatibleRoute } from './Routes/TracksCompatibleRoute.js';
import { TranscodeRoute } from './Routes/TranscodeRoute.js';

/**
 * Tells figtree's `HttpService` which routes to mount. All routes are wired against the
 * already-started `LibraryService` so they share a single in-memory `TrackLibrary`.
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
            new AudioRoute(library),
            new LibraryCoverRoute(library, service.getCoverArtCache()),
            new KeyLabelsRoute(service),
            new KeyProfileSweepRoute(service),
            new TranscodeRoute(new FfmpegTranscoder()),
        ];
    }
}