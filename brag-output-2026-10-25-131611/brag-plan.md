# Brag Plan: Slate (how to use it)

## What is this app?
Slate is an infinite canvas for software teams: draw a diagram, generate it with AI, or write it as code, with docs, live collaboration and sharing on the same board.

## The angle
This is the landing-page showcase video, so it has one job: show a stranger exactly how to use the platform, start to finish, on the real product. Five numbered steps, each one real action in the real UI: **1 Start** (dashboard), **2 Describe** (Slate AI), **3 Refine** (follow-up edit and the icon library), **4 Document** (import a docker-compose file, diagram and docs appear side by side), **5 Share** (one link). A persistent step bar keeps anyone oriented. No browser chrome inside the video, because the landing page already wraps it in a window.

## Hook (first 2-3 seconds)
Frame 0 is already the product: the real dashboard (Quick start templates, New Board) with step 1 lit in the step bar. A cursor glides in, hovers a template, and clicks **New Board** on the 1.64s beat.

## Key moments (the middle)
- Create Slate dialog: the title "Checkout service" types in, **Create** opens the board.
- Slate AI: the cursor opens the panel, clicks the "E-commerce platform" prompt card, "Thinking…" then "Laying out…", and the diagram builds group by group (Clients, Edge, Services, Data) with real brand logos.
- Refine: follow-up "add a cache in front of the database" and Redis slides into the diagram in place; then the AI panel closes, the icon library opens, "kafka" is searched and the Kafka logo is dragged onto the board and wired up.
- Document: Import code / Docker Compose, the docker-compose.yml sample, "Docker Compose detected… No AI credits used.", **Generate diagram & docs**, and the board goes split view with the documentation written beside the diagram (overview table, port map).
- Share: **Share**, "Anyone with the link can edit", **Copy link**.

## Outro / punchline
Lockup: logo, SLATE, "Think. Draw. Collaborate.", and what else is built in (Cloud cost estimate, Traffic simulator, Interview mode), then "Start Free Workspace".

## User flow worth showing
Entry: dashboard Quick start / New Board. Key action: describe a system in plain words. Result: a laid-out, editable diagram, then docs and a share link, all in one board.

## Tone
- Preset: app-store (smooth, feature-card clean), softened toward polished
- Creative direction: a calm product walkthrough, "five steps, no manual"
- Interpretation: steady pacing on the beat grid, one action per beat, soft sound, product copy only. Clean slides and blur swaps; no jokes.

## Format: landscape — 1920x1080
## Duration: 25.0s (steps: 3.8 / 4.4 / 7.6 / 4.3 / 2.2, lockup 2.7)

## Visual identity (from the project)
- Background: #09090B (dashboard) / #0A0A0A (canvas, landing)
- Accent: indigo-to-fuchsia (the AI button and the "Upgrade to Pro" gradient), #C084FC on the lockup, white primary buttons
- Text: #FFFFFF, #E4E4E7, muted #A1A1AA
- Display font: Geist (800 headlines)
- Body font: Geist 400-700; Geist Mono in code panes
- Strongest visual element: the product UI itself, rebuilt from the real components at a 1280×664 design viewport and scaled 1.5× so it stays readable inside the landing window

## Share copy (draft)
How to use Slate in 5 steps: pick a template, describe a system in plain words, follow up to edit it in place, import a docker-compose file for instant docs, share one link.

## Audio direction
- Role: warm bed with soft interaction sounds
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady and clean, ~110 BPM)
- Music treatment: starts at 0s, 0.5 volume then normalised in the final mux, fade-in 0.5s, fade-out 1.8s
- Music cue guidance: bundled preset read. Clicks and step changes are placed on the beat grid (1.64, 3.27, 4.39, 5.45, 6.56, 7.09, 7.64, 8.19, 8.74 …). Strong-cue locks: 8.74s (diagram done, refine begins), 13.11s (library opens), 17.47s (compose sample loaded), 18.56s (Generate diagram & docs), 22.93s (logo).
- Audio-reactive treatment: subtle; the music's bass and level breathe the two background glows around the app and behind the lockup. No waveform visuals.
- SFX posture: sparse and interaction-matched: clicks on the main presses, soft key ticks while typing, drops as panels open, soft impacts on results, one bell on the logo.
- Audio-coupled moments: typed title, typed follow-up, typed search, button presses, panel arrivals, diagram and docs completing.
- Restraint rule: no SFX on every node or table row; no riser/whoosh stacks.

## Storyboard

### Scene 1 — Start — 3.8s (0.0-3.82)
Dashboard at 1280×664 scale: sidebar (Slate, workspace switcher, Slates / Shared Slates / Settings & Members, Usage card with "Upgrade to Pro"), header with "Filter boards…", Starred, **New Board**; "Quick start — Clone an architecture and start editing in seconds." with template cards; boards below. Cursor hovers a template, clicks New Board (1.64s), the "Create Slate" dialog appears, "Checkout service" types in, **Create** (3.27s). Caption: "Start from a template or a blank board."
Sequential/interaction: yes — hover, click, typed title, click. Caption holds the whole scene (3.8s).
Audio intent: gentle click on each press.
Transition mood: blur swap → Scene 2 (the board opens)

### Scene 2 — Describe — 4.4s (3.82-8.19)
Empty board with the real toolbar and pills. Cursor clicks **AI** (4.39), the Slate AI panel slides in ("What should we draw?", Import code / Docker Compose card, prompt cards). Click "E-commerce platform" (5.45). User bubble, "Thinking…", "Laying out…", then the diagram builds on the beat: Clients + Edge (6.56), Services (7.09), Data (7.64), connectors draw, result card lands on 8.19. Caption: "Describe the diagram you want."
Sequential/interaction: yes — groups arrive one by one on beats, nodes stagger inside a group.
Audio intent: a soft drop as the panel opens, soft drops on groups, one impact when the diagram is complete.
Transition mood: clean → Scene 3 (same board)

### Scene 3 — Refine — 7.6s (8.19-15.84)
Follow-up typed into the same panel: "add a cache in front of the database" (the real placeholder wording). The panel shows "Editing diagram". Redis slides in above PostgreSQL and the Catalog connector re-routes through it (11.46). The panel closes, the library opens (13.11): search "kafka", the Kafka tile is dragged onto the board (14.73) and connected to Checkout service. Caption: "Follow up in plain words. Drag in any logo."
Sequential/interaction: yes — typed follow-up, node insert and re-route, library search, drag and drop.
Audio intent: ticks while typing, drop on insert.
Transition mood: clean → Scene 4

### Scene 4 — Document — 4.3s (15.84-20.19)
AI panel back, **Import** (16.93), the dialog "Import code / Docker Compose": click the docker-compose.yml sample (17.47), the sample fills in, banner "Docker Compose detected. Parsed exactly: services, ports, networks and volumes. No AI credits used.", checkbox "Write the documentation into the document pane (opens split view)". Click **Generate diagram & docs** (18.56). The board goes split view: the diagram of six services on the left, the document on the right writing itself (title "shop", overview, services table, port map). Caption: "Import code. The docs write themselves beside it."
Sequential/interaction: yes — sample click, text filling, split view opening, document blocks arriving one by one (headings, table rows).
Audio intent: soft impact when the split view opens.
Transition mood: clean → Scene 5

### Scene 5 — Share — 2.2s (20.19-22.37)
Cursor clicks **Share** (20.75). The Share dialog: "General access", select "Anyone with the link can edit", **Copy link** (21.84) turns into a check. Caption: "Share with one link."
Sequential/interaction: yes — click, option select, copy.
Audio intent: click, click, soft confirm.
Transition mood: blur swap → Scene 6

### Scene 6 — Lockup — 2.6s (22.37-25.0)
The app drops back; lockup lands on the 22.93 strong cue: logo, SLATE, "Think. Draw. Collaborate.", chips "Cloud cost estimate · Traffic simulator · Interview mode", CTA "Start Free Workspace". Holds about 2.0s.
Audio intent: bell on the logo.

**Music mood for this video:** warm, steady
**Audio summary:** a quiet bed with soft clicks and drops that follow the user's actions.

## Grounding notes
- Dashboard (`app/dashboard/page.tsx`, `components/dashboard/*`): sidebar, nav labels, "Quick start", "Clone an architecture and start editing in seconds.", template titles/descriptions/tags (`lib/diagram/starter-templates.ts`), "Create Slate" dialog, "New Board", "Filter boards…", Usage card ("Slates created", "AI credits", "Upgrade to Pro").
- Slate AI (`components/ai-panel/ai-panel.tsx`): "What should we draw?", the description, "Import code / Docker Compose" card and text, prompt cards ("E-commerce platform" and the prompt text), "Start from a template", type and complexity chips, "Describe the change… e.g. “add a cache in front of the database”", "Editing diagram", "Thinking…", "Laying out…", result card buttons (Undo, View code, Edit as code), "AI can be wrong. Everything it draws is editable.". The model line shows the default model from the README.
- Library (`components/canvas/LibraryPanel.tsx`): Icons / Shapes tabs, "Search AWS, Postgres, Kafka, user…", Node card / Icon only, categories; "170+ real product logos" is from the README.
- Import (`components/ai-panel/import-code-dialog.tsx`, `lib/import/compose.ts`): title, description, "Try a sample", sample compose file, detection banner, checkbox, "Generate diagram & docs", and the generated document structure (title, "Generated by Slate from a Docker Compose file", Overview, Services table, Port map).
- Share (`components/canvas/ShareSlateDialog.tsx`): title, "General access", the three options with their hints, "Copy link", "Invite to workspace".
- Built-in features named in the lockup chips are from the README (Cloud cost, Traffic simulator, Interview mode).
- Aarav is a fictional stand-in. No emails, tokens or real user data appear.
