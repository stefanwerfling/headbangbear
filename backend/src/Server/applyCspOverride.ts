import helmet from 'helmet';

type CspOptions = Parameters<typeof helmet.contentSecurityPolicy>[0];

let applied: boolean = false;

/**
 * Extends figtree's default Content-Security-Policy directives so the bambooo SPA can play
 * library audio.
 *
 *  - `mediaSrc 'self' blob:` — `wavesurfer.js` decodes mp3 responses into a `Blob` and
 *    constructs a `blob:` URL for the underlying `<audio>` element. Without this the
 *    browser blocks playback ("Loading media from 'blob:…' violates CSP directive
 *    default-src 'self'"). The `AutoPlayer`'s Web Audio API path uses blob URLs in some
 *    code paths too.
 *
 * Implementation: figtree's `HttpServer` is not re-exported and the package's `exports`
 * map blocks deep imports, so we monkey-patch `helmet.contentSecurityPolicy` (the factory
 * figtree calls at server-setup time) to merge our extra directives. Must be invoked
 * **before** `HttpService.start()` runs — i.e. in the `BackendApp` subclass constructor.
 * Idempotent.
 */
export function applyCspOverride(): void {
    if (applied) {
        return;
    }
    type CspFactory = typeof helmet.contentSecurityPolicy;
    const csp: { contentSecurityPolicy: CspFactory } = helmet as unknown as {
        contentSecurityPolicy: CspFactory;
    };
    const original: CspFactory = csp.contentSecurityPolicy;
    const patched: CspFactory = ((options?: CspOptions) => {
        const merged: CspOptions = {
            ...(options ?? {}),
            directives: {
                ...((options?.directives ?? {}) as Record<string, unknown>),
                mediaSrc: ["'self'", 'blob:'],
                connectSrc: ["'self'", 'blob:']
            }
        };
        return original(merged);
    }) as CspFactory;
    // Preserve the static helpers (`getDefaultDirectives`, `dangerouslyDisableDefaultSrc`,
    // …) that are attached to the factory function as own properties.
    Object.assign(patched, original);
    csp.contentSecurityPolicy = patched;
    applied = true;
}