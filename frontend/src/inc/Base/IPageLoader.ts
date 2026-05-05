import { BasePage } from '../Pages/BasePage.js';

export interface IPageLoader {
    load(page: BasePage): Promise<boolean>;
}