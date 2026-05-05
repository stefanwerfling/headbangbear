import {
    TrackMetadataExtractor,
    type ExtractedMetadata,
} from './TrackMetadataExtractor.js';

/**
 * Test seam: returns whatever the test wired up for a given path. Lookup is by exact
 * filesystem path; unknown paths resolve to empty metadata + no cover, which lets test
 * libraries mix "tagged" and "untagged" fixtures freely.
 */
export class StubMetadataExtractor extends TrackMetadataExtractor {

    private readonly responses: Map<string, ExtractedMetadata>;

    public constructor(responses: Map<string, ExtractedMetadata> = new Map()) {
        super();
        this.responses = responses;
    }

    public set(filePath: string, response: ExtractedMetadata): void {
        this.responses.set(filePath, response);
    }

    public override async extract(filePath: string): Promise<ExtractedMetadata> {
        return Promise.resolve(
            this.responses.get(filePath) ?? { metadata: {}, cover: null },
        );
    }

}