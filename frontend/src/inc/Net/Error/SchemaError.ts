import { SchemaErrors } from 'vts';

/**
 * Thrown when a server response does not match its declared vts schema.
 */
export class SchemaError extends Error {

    private readonly errors: SchemaErrors;

    public constructor(errors: SchemaErrors) {
        super('Response schema validation failed');
        this.errors = errors;
    }

    public getErrors(): SchemaErrors {
        return this.errors;
    }

}