import { Schema } from 'vts';
import { HttpError } from './Error/HttpError.js';
import { UnknownResponse } from './Error/UnknownResponse.js';
import { Response } from './Response.js';

/**
 * Thin fetch wrapper for the Headbangbear API. Validates the JSON body against a vts schema,
 * normalises HTTP and parse errors into `HttpError` / `UnknownResponse`, and lets `SchemaError`
 * bubble up from `Response.isValid`.
 */
export class NetFetch {

    public static async getData<T>(url: string, schema: Schema<T>): Promise<T> {
        const response: globalThis.Response = await fetch(url, {
            method: 'GET',
            cache: 'no-cache',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            redirect: 'follow',
            referrerPolicy: 'no-referrer'
        });
        return NetFetch.parseAndValidate(response, url, schema);
    }

    public static async postData<T>(url: string, body: object, schema: Schema<T>): Promise<T> {
        const response: globalThis.Response = await fetch(url, {
            method: 'POST',
            cache: 'no-cache',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            redirect: 'follow',
            referrerPolicy: 'no-referrer',
            body: JSON.stringify(body)
        });
        return NetFetch.parseAndValidate(response, url, schema);
    }

    private static async parseAndValidate<T>(
        response: globalThis.Response,
        url: string,
        schema: Schema<T>
    ): Promise<T> {
        let parsed: unknown;
        try {
            if (response.status < 200 || response.status >= 300) {
                throw new Error();
            }
            parsed = await response.json();
        } catch {
            if (response.status === 200) {
                throw new UnknownResponse('JSON parse error');
            }
            throw new HttpError(response.statusText, response.status, url);
        }
        Response.isValid(schema, parsed);
        return parsed as T;
    }

}