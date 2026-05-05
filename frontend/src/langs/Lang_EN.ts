import { LangDefine } from 'bambooo';

export class Lang_EN implements LangDefine {

    private readonly _content: { [index: string]: string } = {
        title: 'Headbangbear',

        // Sidemenu
        home: 'Home',
        library: 'Library',
        dj_set: 'DJ Set',
        key_labels: 'Key Labels',
        key_labels_help_title: 'How this works',
        key_labels_help_body: 'Pick the correct key for each track and save. The labels go into <code>&lt;library&gt;/truth.json</code> and are consumed by <code>npm run key-eval</code> + <code>--sweep</code> to score how often the analyser was right and which key-detection profile fits your library best.',
        key_labels_predicted: 'Predicted',
        key_labels_truth: 'Truth',
        key_labels_save: 'Save labels',
        key_labels_saving: 'Saving…',
        key_labels_saved: 'Saved.',
        key_labels_save_failed: 'Save failed',
        key_labels_load_failed: 'Failed to load labels',
        key_labels_labelled: 'labelled',
        key_labels_sweep_title: 'Profile Sweep',
        key_labels_sweep_help: 'Run every selected key-detection profile against your saved labels and rank by MIREX accuracy. <b>First run is slow</b> (~3 s per track per profile, cached after) — subsequent runs return instantly.',
        key_labels_sweep_run: 'Run sweep',
        key_labels_sweep_running: 'Running… first run may take several minutes.',
        key_labels_sweep_done: 'Sweep complete',
        key_labels_sweep_failed: 'Sweep failed',
        key_labels_sweep_best: 'Best profile',
        key_labels_sweep_profile: 'Profile',
        key_labels_sweep_mirex: 'MIREX',
        key_labels_sweep_matched: 'Matched',
        key_labels_sweep_truth_size: 'Truth labels',
        key_labels_sweep_no_profiles: 'Select at least one profile.',
        key_labels_sweep_no_rows: 'No profiles produced any rows.',

        // Common columns / labels
        tracks: 'Tracks',
        compatible_tracks: 'Compatible tracks',
        camelot: 'Camelot',
        open_key: 'Open Key',
        bpm: 'BPM',
        energy: 'Energy',
        drops: 'Drops',
        duration: 'Duration',
        path: 'Path',
        cover: 'Cover',
        track: 'Track',
        artist: 'Artist',
        album: 'Album',
        year: 'Year',
        genre: 'Genre',
        dj_set_now_playing_idle: 'No track playing',
        dj_set_now_playing_index: 'Track',
        dj_set_avoid_same_artist: 'Avoid same artist',
        dj_set_avoid_same_artist_help: 'Beam-search penalises consecutive tracks by the same artist. Length still dominates — this only kicks in as a tiebreaker.',
        bpm_delta: 'BPM Δ',
        no_track_selected: 'Select a track to see compatible matches.',
        loading: 'Loading…',

        // Landing page
        landing_title: 'Welcome to Headbangbear',
        landing_intro: 'Headbangbear (HBB) analyses your music — key, BPM, energy, drops — and helps you build harmonic DJ sets where every transition is musically compatible. Pick a starting track and HBB will find the next one that mixes well in key and tempo.',
        home_intro_audio_disable: 'Disable intro on next visit',
        home_intro_audio_help: 'A short audio intro plays once per fresh visit. Tick to mute it on future visits — your choice persists in localStorage.',
        tab_changelog: 'Changelog',
        tab_guide: 'Guide',

        // Guide — Quick Start
        guide_quickstart_title: 'Quick Start',
        guide_quickstart_step1_title: 'Configure your library',
        guide_quickstart_step1: 'Edit <code>backend/config.json</code> and set <code>library.rootDir</code> to a folder containing your MP3 files. On the very first start HBB analyses every track with essentia.js (key, BPM, energy, drops) and caches the result. Expect ~3 s per track on the first scan; subsequent starts hit the cache and are instant.',
        guide_quickstart_step2_title: 'Run backend + frontend',
        guide_quickstart_step2: 'Two terminals: <code>npm run dev -w @headbangbear/backend</code> (auto-reloading API server) and <code>npm run dev -w @headbangbear/frontend</code> (incremental webpack). Open <code>https://localhost:3777</code> — accept the self-signed cert.',
        guide_quickstart_step3_title: 'Plan a mix on the Library page',
        guide_quickstart_step3: 'Click <b>→ A</b> on a track to load Deck A, then <b>→ B</b> on another to load Deck B. Press <b>Plan Mix</b>. HBB picks cue-out and cue-in points, snaps them to bar boundaries, prefers drop alignment, and reports the required BPM shift. Red regions on the waveforms mark the planned cues.',
        guide_quickstart_step4_title: 'Generate or play a full set',
        guide_quickstart_step4: 'Open the <b>DJ Set</b> page. <b>Generate</b> finds a Camelot-compatible chain through your library; <b>Play</b> streams it through the browser with crossfades and per-track pitch matching. Tick <b>Record set</b> beforehand to download the mix as MP3.',

        // Guide — Library page walkthrough
        guide_library_title: 'Library page',
        guide_library_decks_title: 'Decks A and B',
        guide_library_decks: 'Two cards at the top labelled Deck A (blue) and Deck B (green). Each shows the loaded track\'s cover, artist/title, Camelot/Open-Key/BPM/Energy badges, waveform with drop markers, beat grid, and an orange energy-curve overlay.',
        guide_library_plan_title: 'Plan Mix toolbar',
        guide_library_plan: '<b>Plan Mix A → B</b> computes cue-in/cue-out and pitch-shift for the two loaded decks. <b>Play Transition</b> previews just the crossfade segment in your browser. <b>Add to Setlist</b> stores the plan for the DJ-Set page (Manual mode).',
        guide_library_table_title: 'Track table',
        guide_library_table: 'Below the decks: cover thumb, track title (artist below), Camelot, Open Key, BPM, Energy, drops count, and <b>→ A</b>/<b>→ B</b> buttons per row. Click a row to load Deck A and surface harmonically compatible matches below.',
        guide_library_filters_title: 'Filters',
        guide_library_filters: 'Search box matches filename + artist + title + album + genre. <b>Compatible only</b> hides tracks that are not Camelot-compatible with Deck A. BPM range, Energy range, Year range, Genre dropdown. All filters persist in localStorage.',
        guide_library_sort_title: 'Sortable columns',
        guide_library_sort: 'Click any column header (Track / Camelot / BPM / Energy / Drops) to sort ascending. Click again for descending, third click clears the sort. Sort order is in-memory only — refresh resets it.',
        guide_library_cues_title: 'Hot cues',
        guide_library_cues: '8 numbered slots per track. Click an empty slot to set it at the current playhead, click a filled slot to jump there, <kbd>Shift</kbd>+click to clear. Cues are persisted per-track in localStorage and rendered as cyan markers on the waveform.',
        guide_library_loop_title: 'Loop',
        guide_library_loop: '<b>Loop In</b>/<b>Out</b> mark a region; <b>active</b> auto-jumps back to In whenever the cursor reaches Out. The yellow region on the waveform is draggable (move) and resizable (drag the edges).',
        guide_library_eq_title: 'Per-deck 3-band EQ',
        guide_library_eq: 'LO/MID/HI shelf+peak filters per deck (±12 dB). Wired into wavesurfer\'s audio chain via Web Audio BiquadFilterNodes — affects only that deck\'s playback. Reset returns all bands to 0 dB.',
        guide_library_tempo_title: 'Tempo + Pitch lock',
        guide_library_tempo: '<b>Tempo</b> slider (0.7×–1.3×) re-pitches the deck. <b>Pitch lock</b> preserves the musical key while changing tempo (browser-native time-stretch). Without it, faster = higher pitch like a turntable.',
        guide_library_shortcuts_title: 'Keyboard shortcuts',
        guide_library_shortcuts: '<kbd>Tab</kbd> swaps the active deck (blue border). <kbd>Space</kbd> play/pause. <kbd>1</kbd>–<kbd>8</kbd> trigger hot-cues, <kbd>Shift</kbd>+<kbd>1</kbd>..<kbd>8</kbd> clears. <kbd>Q</kbd>/<kbd>W</kbd> set Loop In/Out, <kbd>E</kbd> clears the loop. Skipped while typing in inputs.',
        guide_library_setlist_title: 'Setlist',
        guide_library_setlist: 'Each <b>Add to Setlist</b> click appends the current planned transition. The counter shows how many entries are queued. The DJ-Set page reads this list when its source is set to <b>Manual</b>. Survives reload via localStorage.',

        // Guide — DJ-Set page walkthrough
        guide_djset_title: 'DJ Set page',
        guide_djset_source_title: 'Auto vs Manual',
        guide_djset_source: 'Top-of-page radio. <b>Auto</b> generates a chain via the backend planner. <b>Manual</b> plays the Setlist you assembled on the Library page — only when each entry\'s <i>to</i> matches the next entry\'s <i>from</i> (continuous chain).',
        guide_djset_strategy_title: 'Strategy: greedy vs beam',
        guide_djset_strategy: '<b>Greedy</b> picks the next compatible track with the smallest energy/BPM delta — fast but can paint itself into a Camelot dead-end. <b>Beam (multi-start)</b> tries every track as a start and keeps the top-K partial chains; slower but reliably finds longer chains.',
        guide_djset_direction_title: 'Energy direction',
        guide_djset_direction: '<b>Up</b> = energies rise (warmup → peak). <b>Down</b> = energies fall (peak → cooldown). <b>Either</b> = no direction bias. Greedy uses this as a hard penalty; beam-search ignores it once an energy shape is set.',
        guide_djset_shape_title: 'Energy shape',
        guide_djset_shape: 'Stronger version of direction. <b>Rising</b> (linear ramp), <b>Arc</b> (warmup → peak → cooldown), <b>Descending</b>. Both planners pick tracks closest to the ideal energy at each chain position. The little SVG preview shows the curve.',
        guide_djset_style_title: 'Transition style',
        guide_djset_style: '<b>Drop-on-Drop</b> (default) aligns A\'s last drop with B\'s first. <b>Tail-Out</b> plays through A\'s drop, then fades. <b>Early-Cut</b> hands off before A\'s drop so B\'s drop is the climax. <b>Bar-Match</b> ignores drops entirely (just bar-syncs).',
        guide_djset_target_title: 'Target duration',
        guide_djset_target: '<b>Target (min)</b> input (empty = no limit). Greedy stops adding tracks once the running estimate reaches the target. Beam ranks chains by closeness to target, overriding "longest chain wins".',
        guide_djset_artist_title: 'Avoid same artist',
        guide_djset_artist: 'Beam-only soft penalty against placing two tracks by the same artist back-to-back. Length and shape still dominate the lex-score; this only kicks in as a tiebreaker between equally-good chains.',
        guide_djset_play_title: 'Play / Now-Playing',
        guide_djset_play: '<b>Play</b> streams the chain through the Web Audio API with crossfades. The chain table highlights the current row; the now-playing card shows cover, "Track N / M", artist, title, album. Side-A/B badges flash on the active EQ row.',
        guide_djset_eq_title: 'Master + per-side EQ',
        guide_djset_eq: 'Master EQ (post-crossfade) and per-side EQ (Side A = even tracks, B = odd) — the classic DJ move: cut bass on the outgoing side during a crossfade, bring it in on the incoming side. All ±12 dB.',
        guide_djset_pitchlock_title: 'AutoPlayer pitch lock',
        guide_djset_pitchlock: '<b>Pitch lock</b> on the AutoPlayer preserves musical key when matching BPMs (browser-native time-stretch). Off = turntable feel; on = professional DJ feel. Toggle live during playback.',
        guide_djset_record_title: 'Set recording → MP3',
        guide_djset_record: '<b>Record set</b> arms the MediaRecorder before <b>Play</b>. After the set finishes, the WebM/Opus blob is auto-transcoded server-side to MP3 (320 kbps mono via ffmpeg/libmp3lame); a download link with size appears.',

        // Guide — Key Labels page walkthrough
        guide_keylabels_title: 'Key Labels page',
        guide_keylabels_label_title: 'Labelling',
        guide_keylabels_label: 'Click the dropdown next to each track and select the correct key (e.g. <code>A minor</code>). <b>Save</b> writes <code>&lt;library&gt;/truth.json</code> — the same format the <code>npm run key-eval</code> CLI consumes.',
        guide_keylabels_sweep_title: 'Profile Sweep',
        guide_keylabels_sweep: 'Below the labels table: tick the essentia profiles you want to evaluate, click <b>Run sweep</b>. The backend predicts each labelled track with each profile, scores via MIREX, and ranks them. First run is slow (~3 s × tracks × profiles); cached afterwards.',
        guide_keylabels_mirex_title: 'Reading the MIREX score',
        guide_keylabels_mirex: 'exact match = 1.0, perfect-fifth off = 0.5, relative major/minor = 0.3, parallel = 0.2, anything else = 0.0. The winning profile (highest average MIREX) is the one to set as the essentia analyser\'s <code>profileType</code>.',

        // Glossary (expanded)
        guide_glossary_title: 'Glossary',
        guide_glossary_camelot_title: 'Camelot Wheel',
        guide_glossary_camelot: 'A circular numbering of the 24 keys (12 major + 12 minor) where two keys are <i>harmonically compatible</i> if they sit at the same number, ±1 number, or are A↔B at the same number. Used by professional DJs to mix in key without dissonance. HBB also reports Open Key notation (Mixed-In-Key) alongside.',
        guide_glossary_bpm_title: 'BPM',
        guide_glossary_bpm: 'Beats per minute — the tempo. HBB matches BPM by pitch-shifting the next track up or down. Up to ~6% is inaudible to most listeners; beyond that the timbre starts to bend, so the planner prefers small BPM jumps.',
        guide_glossary_energy_title: 'Energy',
        guide_glossary_energy: 'A 0..1 measure of how loud / dense / "intense" a track is on average (root-mean-square loudness over the whole file). Used to order a chain so the set rises, falls, or arcs through your selection.',
        guide_glossary_drops_title: 'Drops',
        guide_glossary_drops: 'Detected high-energy moments — the per-second loudness has to spike above a threshold after a quiet run-up. HBB tries to align the outgoing track\'s last drop with the incoming track\'s first drop for a "drop-match" transition. Heuristic: false positives on classical music, false negatives on steady-state EDM.',
        guide_glossary_shape_title: 'Energy shape',
        guide_glossary_shape: '<b>Rising</b> — set starts low, ends high (warmup → peak). <b>Descending</b> — set starts high, ends low (peak → cooldown). <b>Arc</b> — low → high → low, the classic festival main-stage curve. When set, it overrides the simpler "energy direction" option.',
        guide_glossary_pitch_title: 'Pitch shift',
        guide_glossary_pitch: 'Percentage by which the next track is sped up (+) or slowed down (−) so its BPM matches the previous track. HBB reports this per transition; the audible side-effect (without pitch-lock) is a small change in the track\'s key.',
        guide_glossary_pitchlock_title: 'Pitch lock / Master tempo',
        guide_glossary_pitchlock: 'Browser feature that decouples playback rate from pitch (HTMLMediaElement.preservesPitch). Lets HBB tempo-match tracks without re-pitching their key — what professional DJ software does. HBB exposes the toggle on each Deck and on the AutoPlayer.',
        guide_glossary_transitions_title: 'Transition styles',
        guide_glossary_transitions: 'Four mix patterns — <b>Drop-on-Drop</b> aligns the most energetic moments; <b>Tail-Out</b> plays out the outgoing drop before fading; <b>Early-Cut</b> hands off before the outgoing drop so the incoming drop is the peak; <b>Bar-Match</b> ignores drops entirely.',
        guide_glossary_beam_title: 'Beam search',
        guide_glossary_beam: 'Search algorithm that keeps the K best partial chains at every step instead of one (greedy). Multi-start tries every track as a starting point and picks the lex-best result. Finds chains greedy can\'t — Camelot dead-ends, branching graphs, target-duration constraints.',
        guide_glossary_mirex_title: 'MIREX',
        guide_glossary_mirex: 'Music Information Retrieval Evaluation eXchange — the academic benchmark for key-detection algorithms. HBB scores its key-detector against your hand-labelled truth using MIREX\'s weighting, so you can pick the essentia profile that fits your library best.',
        guide_glossary_metadata_title: 'Metadata + cover art',
        guide_glossary_metadata: 'Artist / Title / Album / Year / Genre + cover art are read from embedded ID3 tags (or Vorbis/MP4 atoms) via <code>music-metadata</code>. No network. Cover bytes are cached at <code>&lt;library&gt;/.covers/&lt;sha1&gt;.&lt;ext&gt;</code> and served via <code>/api/v1/library/cover</code>.',

        // Tips
        guide_tips_title: 'Tips',
        guide_tips_search_title: 'Search the metadata, not just filenames',
        guide_tips_search: 'The Library search box matches against filename + artist + title + album + genre — anything the metadata enricher pulled out of ID3 tags. Lowercased substring match.',
        guide_tips_persistence_title: 'Most things persist',
        guide_tips_persistence: 'Filters, transition style, pitch-lock, hot cues, loops, setlist, language — all persist via localStorage. Clear browser site data to reset everything to defaults.',
        guide_tips_recording_title: 'Recording captures everything',
        guide_tips_recording: 'The recording taps the master output post-EQ, post-crossfade — what you hear is what you get. The MediaRecorder produces WebM/Opus; HBB\'s <code>/api/v1/transcode</code> pipes that through ffmpeg → libmp3lame to a 320 kbps MP3.',
        guide_tips_active_deck_title: 'Active deck for shortcuts',
        guide_tips_active_deck: 'On the Library page, click a deck (or use <kbd>Tab</kbd>) to make it <b>active</b> (blue border). Hot-cue / loop / play-pause shortcuts target that deck. Default is Deck A.',
        guide_tips_lang_title: 'Language switch',
        guide_tips_lang: 'Top-right flag buttons (🇺🇸 EN / 🇩🇪 DE) switch language. The choice persists in localStorage; the current page re-renders so freshly-rendered strings pick up the new language.',

        // DJ-Set page
        dj_set_help_title: 'How this works',
        dj_set_help_body: 'Pick a strategy (greedy = fast, beam = slower but finds longer chains), an energy direction or a richer energy shape, optionally a target duration, and click <b>Generate</b>. HBB returns a Camelot-compatible chain through your library. Press <b>Play</b> to hear it through your browser with crossfades and pitch-matching.',
        dj_set_source_label: 'Source:',
        dj_set_strategy: 'Strategy',
        dj_set_direction: 'Energy direction',
        dj_set_shape: 'Energy shape',
        dj_set_shape_help: 'Overrides direction when set. Rising = climb, Arc = warmup→peak→cooldown, Descending = wind-down.',
        dj_set_beam_width: 'Beam width',
        dj_set_target: 'Target (min)',
        dj_set_generate: 'Generate',
        dj_set_play: 'Play',
        dj_set_stop: 'Stop',
        dj_set_record: 'Record set',
        dj_set_master_eq_reset: 'Master EQ Reset',
        dj_set_source_auto: 'Auto-generated',
        dj_set_source_manual: 'Manual setlist',
        dj_set_load_setlist: 'Load setlist',
        dj_set_clear_setlist: 'Clear setlist',
        dj_set_reset_a: 'Reset A',
        dj_set_reset_b: 'Reset B',
        dj_set_click_generate: 'Click <b>Generate</b> to plan a set.',
        dj_set_setlist_empty: 'Setlist is empty. Add transitions on the Library page first.',
        dj_set_setlist_discontinuous: 'Setlist is discontinuous (entry[i].to ≠ entry[i+1].from). Adjust on the Library page.',
        dj_set_manual_not_playable: 'Manual setlist — not playable yet.',
        dj_set_status_generating: 'Generating…',
        dj_set_status_loading_audio: 'Loading audio buffers…',
        dj_set_status_stopped: 'Stopped.',
        dj_set_status_finished: 'Set finished.',
        dj_set_status_empty: 'Empty set.',
        dj_set_status_set_with: 'Set with',
        dj_set_status_tracks: 'tracks',
        dj_set_status_transitions: 'transitions',
        dj_set_status_skipped: 'skipped',
        dj_set_status_now_playing: '▶ Now playing',
        dj_set_status_generate_failed: 'Generate failed',
        dj_set_status_playback_failed: 'Playback failed',
        dj_set_recording_armed: 'armed (will record on next Play)',
        dj_set_recording_active: '● recording',
        dj_set_recording_transcoding: '⟳ transcoding to MP3…',
        dj_set_recording_transcode_failed: 'MP3 transcode failed',
        dj_set_pitch_lock: 'Pitch lock (key lock)',
        dj_set_pitch_lock_help: 'Preserve musical pitch when BPM-matching — uses the browser\'s native time-stretch.',
        dj_set_remove_transition: 'Remove this transition',
        dj_set_manual_setlist: 'Manual setlist',

        // Transition style
        transition_style_label: 'Transition style',
        transition_style_drop_on_drop: 'Drop on drop (climax)',
        transition_style_tail_out: 'Tail out (let A drop, then fade)',
        transition_style_early_cut: 'Early cut (B drop is the climax)',
        transition_style_bar_match: 'Bar match (ignore drops)',

        // Chain table headers
        chain_index: '#',
        chain_track: 'Track',
        chain_pitch: '→ pitch',
        chain_keymatch: '→ keyMatch',
        chain_alignment: '→ alignment',
        chain_bars: '→ bars',

        // Library page
        library_help_title: 'How this works',
        library_help_body: 'Click a track to load it into Deck A and see harmonically compatible candidates highlighted. Use <b>→ A</b>/<b>→ B</b> to load decks and <b>Plan Mix</b> to compute the cue points. Add planned transitions to your Setlist with the <b>+</b> button — they\'re used by the DJ-Set page in <i>Manual</i> mode.',
        library_plan_mix: 'Plan Mix A → B',
        library_play_transition: 'Play Transition',
        library_add_setlist: 'Add to Setlist',
        library_clear_cues: 'Clear cues',
        library_setlist_label: 'Setlist',
        library_setlist_entries: 'entries',
        library_filter_placeholder: 'Filter tracks by filename…',
        library_compatible_with: 'Compatible with',
        library_clear_filters: 'Clear filters',
        library_genre_any: 'any',
        library_compatible_only: 'Compatible only',
        library_search: 'Search',
        library_rescan: 'Rescan library',
        library_load_failed: 'Failed to load library',
        library_rescan_failed: 'Rescan failed',
        library_deck_a: 'Deck A',
        library_deck_b: 'Deck B',

        // Energy-curve chart on DJ-Set page
        chart_title: 'Energy walk',
        chart_actual: 'Actual',
        chart_ideal: 'Ideal curve',

        // Help-tooltip openers
        help: 'Help'
    };

    public getClassName(): string {
        return 'Lang_EN';
    }

    public getLangCode(): string {
        return 'en';
    }

    public getLangTitle(): string {
        return 'English';
    }

    public getCountryCode(): string {
        return 'us';
    }

    public l(content: string): string | null {
        return this._content[content] ?? null;
    }

}