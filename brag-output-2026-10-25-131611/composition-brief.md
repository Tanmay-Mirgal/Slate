# Hyperframes Composition Brief: Slate (how to use it)

## Objective
Create the landing-page showcase video for Slate: a 25-second walkthrough of the real platform in five numbered steps.

## Output
- Composition directory: `brag-output-2026-10-25-131611/composition/`
- Rendered video: `brag-output-2026-10-25-131611/brag.mp4` (copied to `public/slate-how-to.mp4`)
- Format: landscape — 1920x1080, 30 fps, no browser chrome (the landing page already frames it)
- Duration: 25.0 seconds

## Source Material
- Project root: `D:\slate`
- Primary files read: `app/dashboard/page.tsx`, `components/dashboard/{TemplateRail,BoardCard,UsageMeter,bits}.tsx`, `lib/diagram/starter-templates.ts`, `components/ai-panel/{ai-panel,import-code-dialog}.tsx`, `components/canvas/{TopBar,Toolbar,LibraryPanel,ShareSlateDialog,ExportDialog,DocHeader}.tsx`, `lib/import/compose.ts`, `README.md`; the deployed `/playground` was looked at for the real look of the panels.
- Product name: Slate
- Tagline / strongest claim: "Think. Draw. Collaborate."
- Key UI to recreate: dashboard (Quick start, New Board, Create Slate), Slate AI panel, diagram on the canvas with real brand logos, icon library, Import code / Docker Compose dialog, split view with the generated document, Share dialog
- Copy that must appear verbatim: see `brag-plan.md` → Grounding notes

## Creative Direction
- Tone preset: app-store (softened toward polished)
- Creative direction: a calm product walkthrough, "five steps, no manual"
- Interpretation: one action per beat, soft interaction sounds, clean blur swaps, a persistent step bar
- Angle: show a stranger how to use the whole platform on the real UI
- Hook: frame 0 is already the dashboard with step 1 lit
- Outro / punchline: lockup with "Think. Draw. Collaborate.", the other built-in features, "Start Free Workspace"
- Avoid: generic SaaS language, abstract filler, invented product claims

## Visual Identity
- Background: #09090B (dashboard), #0A0A0A (canvas, lockup)
- Text: #FFFFFF / #E4E4E7 / #A1A1AA
- Accent: indigo→fuchsia gradient (AI, upgrade), white primary buttons
- Display font: Geist 800, body Geist 400-700, Geist Mono for code
- Scale: UI designed at 1280×664 and scaled 1.5× into a 1920×996 area; the last 84px is the step bar

## Storyboard
Use `brag-plan.md` as the contract. Scenes: dash (0–4.1), boardA (3.55–16.3, Describe + Refine), boardB (15.84–22.8, Document + Share), outro (22.37–25.0), plus the step bar, one continuous cursor layer and the audio-reactive glow.

## Audio
- Audio role: warm bed with soft interaction sounds
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` at 0.5, fade-in 0.5s, fade-out 1.8s; normalised to -16 LUFS in the final mux
- Music cue guidance: bundled preset (`vol-12.music-cues.json`, ~110 BPM). Clicks and step changes sit on the beat grid; strong cues used: 8.74, 13.11, 17.47, 18.56, 22.37.
- Audio-reactive treatment: subtle; bass and RMS of the bed (sampled every 0.1s with ffmpeg because `extract-audio-data.py` needs Python/numpy, which are not installed) breathe two radial glows in `compositions/glow.html`
- SFX: clicks on the main presses, key ticks while typing (title, follow-up, search), drops as panels open, soft impacts on results, a switch for the access option, a bell on the logo. Files and times are in `index.html`.

## Build notes
- The composition HTML is generated once from the real project sources by a build script kept outside the project; the files in `composition/` are plain Hyperframes HTML and can be edited by hand.
- The cursor is one layer (`compositions/cursor.html`) so its path stays continuous across scenes; the dragged Kafka tile is a ghost in `boardA` that follows the same path and easing.
- Aarav and the sample board names are fictional stand-ins; no user data, emails or tokens appear.
