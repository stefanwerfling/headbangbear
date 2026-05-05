import { Wrapper } from 'bambooo';
import { IPageLoader } from './IPageLoader.js';

export interface IBasePage {
    setPageLoader(loader: IPageLoader): void;
    getWrapper(): Wrapper;
    getName(): string;
    loadContent(): Promise<void>;
    unloadContent(): Promise<void>;
}