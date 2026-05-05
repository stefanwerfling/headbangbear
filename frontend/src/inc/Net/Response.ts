import { Schema, SchemaErrors } from 'vts';
import { SchemaError } from './Error/SchemaError.js';

/**
 * Validates a parsed response body against a vts schema. The HBB backend returns the bare
 * payload (no `{ statusCode, msg, data }` envelope), so this is a pure schema check —
 * unlike kavula's variant which also unwraps figtree's `DefaultReturn`.
 */
export class Response {

    public static isValid<T>(schema: Schema<T>, data: unknown): data is T {
        const errors: SchemaErrors = [];
        if (!schema.validate(data, errors)) {
            throw new SchemaError(errors);
        }
        return true;
    }

}