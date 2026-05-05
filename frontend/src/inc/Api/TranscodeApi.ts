/**
 * Wrapper for `POST /api/v1/transcode`. Uploads the recorded blob raw (no envelope) and
 * receives MP3 bytes back. Doesn't go through `NetFetch` because that validates JSON
 * responses with vts — this endpoint is binary in / binary out.
 */
export class TranscodeApi {

    public static async toMp3(blob: Blob): Promise<Blob> {
        const response: Response = await fetch('api/v1/transcode', {
            method: 'POST',
            headers: {
                'Content-Type': blob.type !== '' ? blob.type : 'application/octet-stream'
            },
            body: blob
        });
        if (!response.ok) {
            let detail: string = '';
            try {
                const errBody: unknown = await response.json();
                if (errBody !== null && typeof errBody === 'object' && 'error' in errBody) {
                    detail = `: ${String((errBody as { error: unknown }).error)}`;
                }
            } catch {
                // response wasn't JSON — keep detail empty
            }
            throw new Error(`Transcode request failed (${response.status.toString()})${detail}`);
        }
        return await response.blob();
    }

}