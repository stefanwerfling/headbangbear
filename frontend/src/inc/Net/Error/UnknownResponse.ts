/**
 * Thrown when the response body cannot be JSON-parsed.
 */
export class UnknownResponse extends Error {

    public constructor(message?: unknown) {
        let msg: string = '';
        if (message) {
            msg = message as string;
        }
        super(msg);
    }

}