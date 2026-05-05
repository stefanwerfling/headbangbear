import {
    ContentCol,
    ContentColSize,
    ContentRow,
    Lang
} from 'bambooo';
import { BasePage } from './BasePage.js';

interface ChangelogEntry {
    iter: number;
    titleEn: string;
    titleDe: string;
    bulletsEn: string[];
    bulletsDe: string[];
}

/**
 * Default landing page. Two Bootstrap nav-tabs:
 *   1. **Changelog** — iteration-by-iteration highlights, bilingual.
 *   2. **Guide** — workflow walkthrough + glossary, bilingual via the `Lang` system.
 *
 * Pulled out of `CHANGELOG.md` (which is more technical) into condensed, user-facing prose.
 * The full file remains the source of truth for engineering changes; this page is the
 * "what can I do with this app today" view.
 */
export class Home extends BasePage {

    protected override _name: string = 'home';

    public constructor() {
        super();
        this.setTitle(Home.lang('title'));
    }

    private static lang(key: string): string {
        return Lang.i().l(key) ?? key;
    }

    /**
     * Inspects the current Lang pack indirectly by translating a stable key. Avoids depending
     * on a hypothetical `Lang.getCurrent()` (bambooo's `Lang` has no public current-pack
     * accessor). Used to pick which side of the bilingual changelog to render.
     */
    private static get langCode(): 'en' | 'de' {
        return Lang.i().l('home') === 'Start' ? 'de' : 'en';
    }

    private static readonly CHANGELOG: ChangelogEntry[] = [
        {
            iter: 23,
            titleEn: 'Energy-curve constraint',
            titleDe: 'Energie-Kurven-Vorgabe',
            bulletsEn: [
                'New <code>energyShape</code> option: <code>rising</code>, <code>arc</code>, <code>descending</code>.',
                'Greedy + Beam planner pick tracks closest to the ideal energy at each chain position.',
                'Available on the DJ-Set page next to "Energy direction".'
            ],
            bulletsDe: [
                'Neue Option <code>energyShape</code>: <code>rising</code>, <code>arc</code>, <code>descending</code>.',
                'Greedy- + Beam-Planner wählen Tracks, deren Energie am nächsten an der idealen Kurvenposition liegt.',
                'Auf der DJ-Set-Seite neben "Energie-Richtung" verfügbar.'
            ]
        },
        {
            iter: 22,
            titleEn: 'Time-budgeted DJ-Set generation',
            titleDe: 'Zeit-budgetierte Set-Erzeugung',
            bulletsEn: [
                '<b>Target (min)</b> input on the DJ-Set page — beam search prefers chains close to that wall-clock duration.',
                'Greedy stops adding tracks once the running estimate hits the target.'
            ],
            bulletsDe: [
                '<b>Zieldauer (min)</b>-Feld auf der DJ-Set-Seite — Beam-Suche bevorzugt Ketten, die der Wall-Clock-Dauer nahekommen.',
                'Greedy stoppt das Anhängen, sobald die laufende Schätzung das Ziel erreicht.'
            ]
        },
        {
            iter: 21,
            titleEn: 'Loop In/Out',
            titleDe: 'Loop In/Out',
            bulletsEn: [
                'Per-deck Loop In / Loop Out / active toggle.',
                'Yellow region painted between the bounds; auto-jumps back when the cursor reaches Out.'
            ],
            bulletsDe: [
                'Pro-Deck Loop In / Loop Out / Active-Schalter.',
                'Gelbe Region zwischen den Grenzen; springt automatisch zurück, sobald der Cursor das Out erreicht.'
            ]
        },
        {
            iter: 20,
            titleEn: 'Hot Cues',
            titleDe: 'Hot Cues',
            bulletsEn: [
                '8 hot-cue slots per track, persisted in localStorage.',
                'Click empty slot = set, click filled = jump, Shift+click = clear. Painted as cyan markers on the waveform.'
            ],
            bulletsDe: [
                '8 Hot-Cue-Slots pro Track, persistent in localStorage.',
                'Klick auf leeren Slot = setzen, Klick auf gefüllten = springen, Shift+Klick = löschen. Cyanfarbene Marker auf der Wellenform.'
            ]
        },
        {
            iter: 19,
            titleEn: 'Per-source EQ A/B',
            titleDe: 'Pro-Source EQ A/B',
            bulletsEn: [
                'Side A and Side B EQ rows on the DJ-Set page below the master EQ.',
                'Cut bass on the outgoing side and bring it in on the incoming during a crossfade.'
            ],
            bulletsDe: [
                'Side-A- und Side-B-EQ-Reihen auf der DJ-Set-Seite unter dem Master-EQ.',
                'Bass auf der auslaufenden Seite absenken und auf der einlaufenden hochbringen — DJ-Standard.'
            ]
        },
        {
            iter: 18,
            titleEn: 'Set recording',
            titleDe: 'Set-Aufnahme',
            bulletsEn: [
                '"Record set" checkbox on the DJ-Set page.',
                'Records the master output (with crossfades + EQ) to a downloadable WebM/Opus file.'
            ],
            bulletsDe: [
                '"Set aufnehmen"-Häkchen auf der DJ-Set-Seite.',
                'Nimmt das Master-Signal (mit Crossfades + EQ) als WebM/Opus-Datei auf.'
            ]
        },
        {
            iter: 17,
            titleEn: 'Master EQ on AutoPlayer',
            titleDe: 'Master-EQ im AutoPlayer',
            bulletsEn: [
                'LO/MID/HI shelf+peak filters on the AutoPlayer master bus.',
                'Lives next to the master volume on the DJ-Set page.'
            ],
            bulletsDe: [
                'LO/MID/HI Shelf+Peak-Filter auf dem AutoPlayer-Master-Bus.',
                'Sitzt neben der Master-Lautstärke auf der DJ-Set-Seite.'
            ]
        },
        {
            iter: 16,
            titleEn: 'Per-deck 3-band EQ',
            titleDe: 'Pro-Deck 3-Band-EQ',
            bulletsEn: [
                'LO/MID/HI sliders per Deck (Library page).',
                'Wired into the wavesurfer audio chain via Web Audio BiquadFilterNodes.'
            ],
            bulletsDe: [
                'LO/MID/HI-Schieber pro Deck (Bibliotheks-Seite).',
                'In die Wavesurfer-Audio-Chain via Web Audio BiquadFilterNodes integriert.'
            ]
        },
        {
            iter: 15,
            titleEn: 'Beat-grid + Compatible filter + Master volume',
            titleDe: 'Beat-Grid + Kompatibel-Filter + Master-Lautstärke',
            bulletsEn: [
                'Faint vertical lines on every beat / bold every 4th bar on the deck waveform.',
                '"Compatible only" toggle on the Library — hides rows incompatible with Deck A.',
                'Master volume slider — shared between Library and DJ-Set pages.'
            ],
            bulletsDe: [
                'Feine senkrechte Linien auf jedem Beat / fett jedem 4. Takt auf der Deck-Wellenform.',
                '"Nur kompatible"-Schalter in der Bibliothek — versteckt Zeilen die nicht zu Deck A passen.',
                'Master-Lautstärke-Schieber — geteilt zwischen Bibliotheks- und DJ-Set-Seite.'
            ]
        },
        {
            iter: 14,
            titleEn: 'Now-Playing waveform + DJ visualisations',
            titleDe: 'Now-Playing-Wellenform + DJ-Visualisierungen',
            bulletsEn: [
                'Dedicated Now-Playing deck on the DJ-Set page that follows the AutoPlayer.',
                'Energy curve overlay (orange) on every deck.',
                'Library search-by-filename.'
            ],
            bulletsDe: [
                'Eigene Now-Playing-Deck auf der DJ-Set-Seite, die dem AutoPlayer folgt.',
                'Energie-Kurven-Overlay (orange) auf jedem Deck.',
                'Bibliotheks-Suche nach Dateinamen.'
            ]
        },
        {
            iter: 13,
            titleEn: 'Setlist persistence + Library rescan',
            titleDe: 'Setlist-Persistenz + Bibliothek neu scannen',
            bulletsEn: [
                'Manual setlist persists across page reloads (localStorage).',
                'Sync button on the Library card-header re-runs the analysis pipeline.'
            ],
            bulletsDe: [
                'Manuelle Setliste bleibt über Page-Reloads erhalten (localStorage).',
                'Sync-Button im Bibliotheks-Card-Header startet die Analyse-Pipeline neu.'
            ]
        },
        {
            iter: 1,
            titleEn: 'Foundations: Camelot, OpenKey, Library, MixTransition',
            titleDe: 'Grundlagen: Camelot, OpenKey, Bibliothek, MixTransition',
            bulletsEn: [
                'Audio analysis pipeline (essentia.js + ffmpeg) — extracts key, BPM, energy, beats, drops.',
                'Camelot-wheel + Open Key compatibility logic.',
                'Drop-aligned + energy-aligned mix transitions.',
                'Greedy → multi-start beam DJ-set planner.',
                'figtree HTTP API + bambooo SPA frontend.'
            ],
            bulletsDe: [
                'Audio-Analyse-Pipeline (essentia.js + ffmpeg) — extrahiert Tonart, BPM, Energie, Beats, Drops.',
                'Camelot-Wheel + Open-Key-Kompatibilitäts-Logik.',
                'Drop- und energiealignierte Mix-Übergänge.',
                'Greedy → Multi-Start-Beam DJ-Set-Planner.',
                'figtree HTTP-API + bambooo-SPA-Frontend.'
            ]
        }
    ];

    public override async loadContent(): Promise<void> {
        const content = this.getContent();
        content.empty();

        const introRow = new ContentRow(content);
        const introCol = new ContentCol(introRow, ContentColSize.col12);
        const introMuted: boolean = Home.isIntroDisabled();
        const $introCard: JQuery<HTMLDivElement> = jQuery<HTMLDivElement>(`
            <div class="card card-primary card-outline">
                <div class="card-body">
                    <div class="d-flex align-items-center" style="gap:1.5rem; flex-wrap:wrap;">
                        <img src="assets/img/logo.png" alt="Headbangbear" class="hbb-logo"
                             style="width:240px; height:240px; flex:0 0 auto; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,0.15);">
                        <div style="flex:1 1 280px; min-width:240px;">
                            <h2 class="mt-0 mb-2" style="font-weight:600;">${Home.lang('landing_title')}</h2>
                            <p class="lead mb-2">${Home.lang('landing_intro')}</p>
                            <div class="d-flex align-items-center flex-wrap" style="gap:0.75rem;">
                                <audio class="hbb-intro-audio" src="assets/audio/logo.mp3" preload="auto" controls style="height:32px;"></audio>
                                <label class="mb-0 small text-muted" title="${Home.lang('home_intro_audio_help')}">
                                    <input type="checkbox" class="hbb-intro-mute" ${introMuted ? 'checked' : ''}>
                                    ${Home.lang('home_intro_audio_disable')}
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `);
        introCol.getElement().append($introCard);
        Home.wireIntroAudio($introCard);

        const tabsRow = new ContentRow(content);
        const tabsCol = new ContentCol(tabsRow, ContentColSize.col12);
        const $tabsCard: JQuery<HTMLDivElement> = jQuery<HTMLDivElement>(`
            <div class="card card-primary card-outline card-outline-tabs">
                <div class="card-header p-0 border-bottom-0">
                    <ul class="nav nav-tabs" role="tablist">
                        <li class="nav-item">
                            <a class="nav-link active" data-bs-toggle="pill" data-toggle="pill" href="#hbb-tab-changelog" role="tab" aria-controls="hbb-tab-changelog" aria-selected="true">
                                <i class="fas fa-history mr-1"></i>${Home.lang('tab_changelog')}
                            </a>
                        </li>
                        <li class="nav-item">
                            <a class="nav-link" data-bs-toggle="pill" data-toggle="pill" href="#hbb-tab-guide" role="tab" aria-controls="hbb-tab-guide" aria-selected="false">
                                <i class="fas fa-book mr-1"></i>${Home.lang('tab_guide')}
                            </a>
                        </li>
                    </ul>
                </div>
                <div class="card-body">
                    <div class="tab-content">
                        <div class="tab-pane fade show active" id="hbb-tab-changelog" role="tabpanel">
                            ${Home.renderChangelog()}
                        </div>
                        <div class="tab-pane fade" id="hbb-tab-guide" role="tabpanel">
                            ${Home.renderGuide()}
                        </div>
                    </div>
                </div>
            </div>
        `);
        tabsCol.getElement().append($tabsCard);

        // Bootstrap-5 needs explicit init for tabs created after page load (the global jQuery
        // delegation that BS4/AdminLTE relied on doesn't fire for `data-bs-toggle`). Wire each
        // tab link manually so click switches the active pane.
        Home.wireTabs($tabsCard);
    }

    /**
     * Audio-intro behaviour:
     *   - On the first visit per tab (gated by `sessionStorage` so the intro doesn't fire
     *     again when the user navigates back to Home), try `audio.play()` immediately. Most
     *     browsers block unmuted autoplay until the user has interacted with the site, so
     *     the initial promise often rejects.
     *   - On rejection, install a one-shot global listener on `pointerdown` / `keydown` —
     *     the very next user gesture (click, tap, key press) triggers the play. The
     *     listener removes itself after firing so it never interferes with normal input.
     *   - The "Disable on next visit" checkbox writes to `localStorage` and short-circuits
     *     both the immediate attempt and the deferred listener; if the audio is already
     *     playing when ticked, it pauses immediately.
     *   - The browser-native `<audio controls>` stays visible regardless so the user can
     *     replay manually.
     */
    private static wireIntroAudio($card: JQuery<HTMLDivElement>): void {
        const $audio = $card.find<HTMLAudioElement>('audio.hbb-intro-audio');
        const $mute = $card.find<HTMLInputElement>('input.hbb-intro-mute');
        if ($audio.length === 0) {
            return;
        }
        const audioEl: HTMLAudioElement = $audio[0] as HTMLAudioElement;

        let cancelled: boolean = false;
        const tryPlay = (): Promise<void> => audioEl.play().then((): void => {
            Home.markIntroPlayed();
        });

        if (!Home.isIntroDisabled() && !Home.wasIntroPlayed()) {
            tryPlay().catch((): void => {
                // Autoplay blocked — defer to the next user gesture.
                const gestureHandler = (): void => {
                    document.removeEventListener('pointerdown', gestureHandler, true);
                    document.removeEventListener('keydown', gestureHandler, true);
                    if (cancelled || Home.isIntroDisabled() || Home.wasIntroPlayed()) {
                        return;
                    }
                    void tryPlay().catch((): void => {
                        // Even with a gesture the play could fail (audio decode error,
                        // autoplay-on-mute policies, etc.) — leave the controls visible so
                        // the user can hit play manually.
                    });
                };
                document.addEventListener('pointerdown', gestureHandler, { capture: true, once: false });
                document.addEventListener('keydown', gestureHandler, { capture: true, once: false });
            });
        }

        $mute.on('change', (e): void => {
            const checked: boolean = jQuery(e.currentTarget).is(':checked');
            Home.setIntroDisabled(checked);
            if (checked) {
                cancelled = true;
                if (!audioEl.paused) {
                    audioEl.pause();
                    audioEl.currentTime = 0;
                }
            }
        });
    }

    private static isIntroDisabled(): boolean {
        try {
            return window.localStorage.getItem('hbb.intro-disabled.v1') === 'true';
        } catch {
            return false;
        }
    }

    private static setIntroDisabled(disabled: boolean): void {
        try {
            window.localStorage.setItem('hbb.intro-disabled.v1', disabled ? 'true' : 'false');
        } catch {
            // localStorage unavailable — flag is in-memory only for this session.
        }
    }

    private static wasIntroPlayed(): boolean {
        try {
            return window.sessionStorage.getItem('hbb.intro-played.v1') === 'true';
        } catch {
            return false;
        }
    }

    private static markIntroPlayed(): void {
        try {
            window.sessionStorage.setItem('hbb.intro-played.v1', 'true');
        } catch {
            // sessionStorage unavailable — flag is in-memory only for this session.
        }
    }

    private static wireTabs($card: JQuery<HTMLDivElement>): void {
        const $links: JQuery<HTMLAnchorElement> = $card.find<HTMLAnchorElement>('.nav-link[data-bs-toggle="pill"]');
        $links.on('click', (e): void => {
            e.preventDefault();
            const $clicked: JQuery<HTMLAnchorElement> = jQuery(e.currentTarget);
            const targetSel: string | undefined = $clicked.attr('href');
            if (targetSel === undefined) {
                return;
            }
            $links.removeClass('active').attr('aria-selected', 'false');
            $clicked.addClass('active').attr('aria-selected', 'true');
            $card.find<HTMLDivElement>('.tab-pane').removeClass('show active');
            $card.find<HTMLDivElement>(targetSel).addClass('show active');
        });
    }

    private static renderChangelog(): string {
        const code: 'en' | 'de' = Home.langCode;
        const items: string = Home.CHANGELOG.map((entry: ChangelogEntry): string => {
            const title: string = code === 'de' ? entry.titleDe : entry.titleEn;
            const bullets: readonly string[] = code === 'de' ? entry.bulletsDe : entry.bulletsEn;
            const bulletHtml: string = bullets.map((b: string): string => `<li>${b}</li>`).join('');
            return `
                <div class="hbb-changelog-entry mb-3">
                    <h5 class="mb-1">
                        <span class="badge badge-secondary mr-2">v${entry.iter.toString()}</span>
                        ${title}
                    </h5>
                    <ul class="mb-0">${bulletHtml}</ul>
                </div>
            `;
        }).join('');
        return items;
    }

    /**
     * Top-level guide structure: an ordered list of sections, each with an icon, a title
     * lang-key, and a list of `{titleKey, bodyKey}` items. Two visual styles — the workflow
     * sections render as numbered steps; glossary/tips render with an info-icon.
     */
    private static readonly GUIDE: ReadonlyArray<{
        icon: string;
        titleKey: string;
        style: 'workflow' | 'glossary';
        items: ReadonlyArray<{ titleKey: string; bodyKey: string }>;
    }> = [
        {
            icon: 'fa-rocket',
            titleKey: 'guide_quickstart_title',
            style: 'workflow',
            items: [
                { titleKey: 'guide_quickstart_step1_title', bodyKey: 'guide_quickstart_step1' },
                { titleKey: 'guide_quickstart_step2_title', bodyKey: 'guide_quickstart_step2' },
                { titleKey: 'guide_quickstart_step3_title', bodyKey: 'guide_quickstart_step3' },
                { titleKey: 'guide_quickstart_step4_title', bodyKey: 'guide_quickstart_step4' },
            ],
        },
        {
            icon: 'fa-music',
            titleKey: 'guide_library_title',
            style: 'glossary',
            items: [
                { titleKey: 'guide_library_decks_title', bodyKey: 'guide_library_decks' },
                { titleKey: 'guide_library_plan_title', bodyKey: 'guide_library_plan' },
                { titleKey: 'guide_library_table_title', bodyKey: 'guide_library_table' },
                { titleKey: 'guide_library_filters_title', bodyKey: 'guide_library_filters' },
                { titleKey: 'guide_library_sort_title', bodyKey: 'guide_library_sort' },
                { titleKey: 'guide_library_cues_title', bodyKey: 'guide_library_cues' },
                { titleKey: 'guide_library_loop_title', bodyKey: 'guide_library_loop' },
                { titleKey: 'guide_library_eq_title', bodyKey: 'guide_library_eq' },
                { titleKey: 'guide_library_tempo_title', bodyKey: 'guide_library_tempo' },
                { titleKey: 'guide_library_shortcuts_title', bodyKey: 'guide_library_shortcuts' },
                { titleKey: 'guide_library_setlist_title', bodyKey: 'guide_library_setlist' },
            ],
        },
        {
            icon: 'fa-record-vinyl',
            titleKey: 'guide_djset_title',
            style: 'glossary',
            items: [
                { titleKey: 'guide_djset_source_title', bodyKey: 'guide_djset_source' },
                { titleKey: 'guide_djset_strategy_title', bodyKey: 'guide_djset_strategy' },
                { titleKey: 'guide_djset_direction_title', bodyKey: 'guide_djset_direction' },
                { titleKey: 'guide_djset_shape_title', bodyKey: 'guide_djset_shape' },
                { titleKey: 'guide_djset_style_title', bodyKey: 'guide_djset_style' },
                { titleKey: 'guide_djset_target_title', bodyKey: 'guide_djset_target' },
                { titleKey: 'guide_djset_artist_title', bodyKey: 'guide_djset_artist' },
                { titleKey: 'guide_djset_play_title', bodyKey: 'guide_djset_play' },
                { titleKey: 'guide_djset_eq_title', bodyKey: 'guide_djset_eq' },
                { titleKey: 'guide_djset_pitchlock_title', bodyKey: 'guide_djset_pitchlock' },
                { titleKey: 'guide_djset_record_title', bodyKey: 'guide_djset_record' },
            ],
        },
        {
            icon: 'fa-tag',
            titleKey: 'guide_keylabels_title',
            style: 'glossary',
            items: [
                { titleKey: 'guide_keylabels_label_title', bodyKey: 'guide_keylabels_label' },
                { titleKey: 'guide_keylabels_sweep_title', bodyKey: 'guide_keylabels_sweep' },
                { titleKey: 'guide_keylabels_mirex_title', bodyKey: 'guide_keylabels_mirex' },
            ],
        },
        {
            icon: 'fa-book-open',
            titleKey: 'guide_glossary_title',
            style: 'glossary',
            items: [
                { titleKey: 'guide_glossary_camelot_title', bodyKey: 'guide_glossary_camelot' },
                { titleKey: 'guide_glossary_bpm_title', bodyKey: 'guide_glossary_bpm' },
                { titleKey: 'guide_glossary_energy_title', bodyKey: 'guide_glossary_energy' },
                { titleKey: 'guide_glossary_drops_title', bodyKey: 'guide_glossary_drops' },
                { titleKey: 'guide_glossary_shape_title', bodyKey: 'guide_glossary_shape' },
                { titleKey: 'guide_glossary_pitch_title', bodyKey: 'guide_glossary_pitch' },
                { titleKey: 'guide_glossary_pitchlock_title', bodyKey: 'guide_glossary_pitchlock' },
                { titleKey: 'guide_glossary_transitions_title', bodyKey: 'guide_glossary_transitions' },
                { titleKey: 'guide_glossary_beam_title', bodyKey: 'guide_glossary_beam' },
                { titleKey: 'guide_glossary_mirex_title', bodyKey: 'guide_glossary_mirex' },
                { titleKey: 'guide_glossary_metadata_title', bodyKey: 'guide_glossary_metadata' },
            ],
        },
        {
            icon: 'fa-lightbulb',
            titleKey: 'guide_tips_title',
            style: 'glossary',
            items: [
                { titleKey: 'guide_tips_search_title', bodyKey: 'guide_tips_search' },
                { titleKey: 'guide_tips_persistence_title', bodyKey: 'guide_tips_persistence' },
                { titleKey: 'guide_tips_recording_title', bodyKey: 'guide_tips_recording' },
                { titleKey: 'guide_tips_active_deck_title', bodyKey: 'guide_tips_active_deck' },
                { titleKey: 'guide_tips_lang_title', bodyKey: 'guide_tips_lang' },
            ],
        },
    ];

    private static renderGuide(): string {
        return Home.GUIDE.map((section): string => {
            const itemsHtml: string = section.items.map(
                (it, idx): string => Home.renderGuideItem(it, idx + 1, section.style),
            ).join('');
            return `
                <h5 class="mt-3 mb-2"><i class="fas ${section.icon} mr-2"></i>${Home.lang(section.titleKey)}</h5>
                ${itemsHtml}
                <hr class="my-3">
            `;
        }).join('');
    }

    private static renderGuideItem(
        item: { titleKey: string; bodyKey: string },
        index: number,
        style: 'workflow' | 'glossary',
    ): string {
        if (style === 'workflow') {
            return `
                <div class="mb-3 d-flex" style="gap:0.75rem;">
                    <span class="badge badge-primary" style="height:1.6rem; padding-top:0.4rem;">${index.toString()}</span>
                    <div style="flex:1;">
                        <h6 class="mb-1">${Home.lang(item.titleKey)}</h6>
                        <p class="mb-0">${Home.lang(item.bodyKey)}</p>
                    </div>
                </div>
            `;
        }
        return `
            <div class="mb-3">
                <h6 class="mb-1"><i class="fas fa-circle-info mr-1 text-info"></i>${Home.lang(item.titleKey)}</h6>
                <p class="mb-0">${Home.lang(item.bodyKey)}</p>
            </div>
        `;
    }

}