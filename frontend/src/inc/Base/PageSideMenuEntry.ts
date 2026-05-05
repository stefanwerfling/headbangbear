import { LangText } from 'bambooo';
import { BasePage } from '../Pages/BasePage.js';

/**
 * Side-menu entry. Mirrors kavula's shape minus the `aclRight` field — Headbangbear has no
 * auth/ACL layer yet, so every page is reachable.
 */
export type PageSideMenuEntry = {
    title: string | LangText;
    icon: string;
    name: string;
    page?: typeof BasePage;
    items?: PageSideMenuEntry[];
};