/**
 * Thrown by `NetFetch` when the response carries a non-2xx HTTP status.
 */
export class HttpError extends Error {

    protected _status: number = 0;

    protected _url: string = '';

    public constructor(message: string, status: number, url: string) {
        super(message);
        this._status = status;
        this._url = url;
    }

    public getStatus(): number {
        return this._status;
    }

    public getUrl(): string {
        return this._url;
    }

}