import { bootstrap, type BootstrapResult } from 'figtree';
import { HeadbangbearApp } from './Server/HeadbangbearApp.js';

const main: () => Promise<void> = async (): Promise<void> => {
    const result: BootstrapResult = await bootstrap((): HeadbangbearApp => new HeadbangbearApp());
    await result.start();
};

void main().catch((err: unknown): void => {
    console.error('Fatal error during bootstrap:', err);
    process.exit(1);
});