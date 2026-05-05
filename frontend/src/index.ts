import { PageLoader } from './inc/PageLoader.js';
import { Home as HomePage } from './inc/Pages/Home.js';

/**
 * Entry: load the default page through the singleton `PageLoader`.
 */
(async(): Promise<void> => {
    await PageLoader.getInstance().load(new HomePage());
})();