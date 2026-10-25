# Hyperframes Composition Brief: Slate

## Objective
Create a short launch-style brag video for Slate.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080, 30 fps
- Duration: 23.2 seconds

## Source Material
- Project root: `D:\slate`
- Primary files read: `README.md`, `app/page.tsx` (landing), `app/layout.tsx`, `app/globals.css`, `lib/diagram/templates.ts`, `lib/billing/plans.ts`, `lib/simulation/topology.ts`, `components/canvas/TrafficSimulator.tsx`, `components/canvas/CursorsOverlay.tsx`, `components/ai-panel/ai-panel.tsx`, `public/demo.png`, `public/logo.png`
- Product name: Slate
- Tagline / strongest claim: "Think. Draw. Collaborate."
- Key UI or visual moment to recreate: the landing prompt bar, the canvas window ("slate.app/canvas", "Realtime Connected"), the AI-laid-out e-commerce microservices diagram, live cursors, the "Simulating traffic" HUD with the SPOF badge
- Copy that must appear verbatim:
  - Think. Draw. Collaborate.
  - Start Free Workspace
  - Describe architecture (e.g. 'Uber LLD' or 'E-Commerce Microservices')...
  - Simulating traffic, 1 SPOF, Single point of failure, Realtime Connected, slate.app/canvas

## Creative Direction
- Tone preset: polished
- Creative direction: quiet premium product film, one sentence in and an architecture out
- Interpretation: four scenes, longer holds, soft sound, product copy only
- Angle: type "E-Commerce Microservices" into the prompt bar, watch the canvas open from it and the diagram build group by group, meet two teammates live, run traffic and catch a single point of failure, then pull back on the real generated diagram and land on the brand line
- Hook: "Describe anything." over the real prompt bar, typed prompt, Generate click on the 3.27s beat
- Outro / punchline: "Draw it. Generate it. Write it as code." then logo, SLATE, "Think. Draw. Collaborate.", "Start Free Workspace"
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign

## Visual Identity
- Background: #0A0A0A
- Text: #FFFFFF (secondary #C5C5C5, muted #A3A3AD on video for contrast)
- Accent: #C084FC (purple glow, sparkles), supporting #3B82F6 / #10B981 / #FBBF24, cursor peers #A78BFA and #F472B6, simulator cyan #22D3EE
- Display font: Geist 800 (downloaded woff2 files in `assets/fonts/`)
- Body font: Geist 400-700, Geist Mono bundled but unused
- Visual references from the project: landing-hero glows, dark node cards with coloured outlines (demo.png), real brand logos from simple-icons, lucide icons, real cursor shape

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Prompt — 0.0-3.3s (morph to 3.85) — "Describe anything." over the prompt bar, typed prompt, Generate click
2. Build — 3.27-10.4s — window opens from the bar, Thinking / Laying out, four groups on the beat, connectors with labels, "Nothing overlaps."
3. Live — 9.3-17.0s — "Teammates, live." (Aarav, Meera), "Watch it run." (simulator HUD, packets), "Catch single points of failure." (SPOF badge + tooltip)
4. Scale and lockup — 16.9-23.2s — real diagram zoom-out, "Draw it. Generate it. Write it as code.", logo lockup and CTA

## Audio
- Audio role: sparse professional accents over one warm bed
- Audio arc: quiet typing and a click, soft drops as groups arrive, one impact on the build completing, switch and bong in the simulator, soft impact on the outro and a bell on the logo
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: starts at 0s, volume 0.32, fade-in 0.5s, fade-out 1.8s
- Music cue guidance: bundled preset `vol-12.music-cues.json` (about 110 BPM). Locks used: 8.74s, 10.93s, 13.11s, 17.47s, 18.56s (strong), Generate click on the 3.27s beat, group reveals on 4.39 / 5.45 / 6.56 / 7.64
- Audio-reactive treatment: subtle. Bass and RMS of the music bed (sampled every 0.1s) breathe the two radial glows in `compositions/glow.html`. `media-use`'s `extract-audio-data.py` needs Python and numpy, which are not installed on this machine, so an equivalent ffmpeg-based RMS and bass extraction was used at build time. No waveform or equalizer visuals.
- Audio-coupled moments:
  - Typed prompt — soft keypress on every third character
  - Generate click — `ui/click2` on the press
  - Group reveals — soft drops on the four beats
  - Build complete / outro open — soft impacts on strong cues
  - Simulator on — switch sound; SPOF badge — one bong
  - Logo — bell
- SFX selection guidance: low high-frequency-risk files only (`sfx-analysis.md`), volumes 0.3-0.65
- SFX analysis guidance: `<skill-dir>/assets/sfx/sfx-analysis.md`
- Exact SFX choice: filenames and timestamps are in `index.html` (`<audio id="sfx-N">`), chosen after the animation existed
- Audio files: copied into `brag-output/composition/assets/`

## Hyperframes Instructions
Load the composition-building Hyperframes skills — `hyperframes`, `hyperframes-registry`, `media-use`, `hyperframes-cli`. /brag is its own workflow: skip the `hyperframes` storyline step. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project. (Real: `public/demo.png`, `public/logo.png`, landing prompt bar and copy, template diagram, simulator HUD, cursor shape, brand logos.)
- Keep all text readable in the final render.
- Keep the video within 15-25 seconds. (23.2s)
- Include the planned music/SFX layer.
- Keep creation and rendering local.

Build notes:
- The composition HTML is generated once from the real project sources by a build script kept outside the project (icons from `simple-icons` and `lucide-react`, node and edge geometry, audio data). The generated files in `composition/` are plain Hyperframes HTML and can be edited by hand.
- Two nodes from the built-in template (Fulfilment worker, Email provider) are left out so the board stays readable at 1080p.
- Aarav and Meera are fictional stand-ins; no user data is shown.
