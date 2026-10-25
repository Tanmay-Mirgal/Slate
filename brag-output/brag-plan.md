# Brag Plan: Slate

## What is this app?
Slate is an infinite canvas for software teams: draw a diagram, generate it with AI from one sentence, or write it as code, with live cursors, a traffic simulator and a cost estimate on the same board.

## The angle
One sentence in, a whole architecture out. The hero is the product doing its thing: a prompt gets typed into the real landing-page prompt bar, the canvas opens from that bar, the AI-laid-out diagram builds group by group, teammates show up with live cursors, and the traffic simulator flags a single point of failure. The close pulls back on the real AI-generated diagram that ships in `public/demo.png` to show the scale, then lands on the brand line "Think. Draw. Collaborate."

## Hook (first 2-3 seconds)
"Describe anything." as the hero headline over the real prompt bar. The bar's placeholder gives way to a typed prompt, "E-Commerce Microservices", character by character with soft key ticks. A cursor presses **Generate**.

## Key moments (the middle)
- The prompt bar grows into the canvas window ("slate.app/canvas", "Realtime Connected"). A "Thinking" then "Laying out" status chip, then the diagram builds one group at a time: Clients, Edge, Services, Data, with the real brand logos (Next.js, Cloudflare, Node.js, Stripe, PostgreSQL, Redis, Elasticsearch, Kafka) and the connectors drawing themselves in with their labels (HTTPS, verify token, charge, SQL, OrderPlaced). Caption lands on the strong cue: "Nothing overlaps."
- Two named teammates (fictional stand-ins: Aarav, Meera) arrive with live cursors and selection rings. Caption: "Teammates, live."
- The "Simulating traffic" HUD slides up, glowing packets run along the arrows (amber for the async OrderPlaced link), and the API gateway gets the pulsing amber single-point-of-failure badge and its tooltip. HUD button reads "1 SPOF". Captions: "Watch it run." then "Catch single points of failure."

## Outro / punchline
Pull back to the real generated architecture diagram, starting zoomed in on legible nodes and zooming out to reveal how big it is. Three lines from the README: "Draw it." "Generate it." "Write it as code." Then the lockup: logo, SLATE, "Think. Draw. Collaborate.", and the landing CTA "Start Free Workspace".

## User flow worth showing
Entry: prompt bar on the landing page. Key action: type "E-Commerce Microservices" and press Generate. Result: the diagram builds on the canvas, then live collaboration and traffic simulation on that same board.

## Tone
- Preset: polished
- Creative direction: quiet premium product film, one sentence in and an architecture out
- Interpretation: fewer scenes, longer holds, confident restraint. Soft sound, no jokes, and the product's own copy doing the talking.

## Format: landscape — 1920x1080
## Duration: 23.2s (scene lengths: prompt 3.3s, canvas build 5.5s, live collaboration 7.8s, outro 6.6s; scenes overlap on transitions)

## Visual identity (from the project)
- Background: #0A0A0A (`--background`)
- Accent: #C084FC (purple-400, the sparkle/glow on the landing page), supporting blue #3B82F6, amber #FBBF24, emerald #10B981
- Text: #FFFFFF, secondary #C5C5C5, muted #808080 (cards #141414, hairlines #2B2B2B)
- Display font: Geist (800 for headlines, gradient white to 60% like the landing hero)
- Body font: Geist 400-600, Geist Mono for small meta
- Strongest visual element: the landing hero (purple + blue radial glows behind the prompt bar) and the dark node cards with coloured outlines from `public/demo.png`

## Share copy (draft)
Slate: type "E-Commerce Microservices", get the architecture. Live cursors, a traffic simulator that flags single points of failure, and docs next to the canvas. Think. Draw. Collaborate.

## Audio direction
- Role: sparse professional accents over one warm bed
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady and clean, ~110 BPM)
- Music treatment: starts at 0s, fades in over 0.5s, sits at 0.32 volume, fades out over the last 1.8s
- Music cue guidance: bundled preset read (`vol-12.music-cues.md`). Strong cues used as locks: 8.74s (diagram complete / "Nothing overlaps."), 10.93s ("Teammates, live."), 13.11s (traffic simulator on), 17.47s (outro opens on the real diagram), 18.56s ("Write it as code."). The Generate click lands on the 3.27s beat. Group reveals ride the beat grid at 4.39, 5.45, 6.56, 7.64.
- Audio-reactive treatment: subtle; bass energy of the music breathes the purple and blue background glows behind the window and behind the lockup. No waveform or equalizer visuals.
- SFX posture: sparse, motion-matched, low high-frequency-risk files only
- Audio-coupled moments: typed prompt (soft key ticks on every third character), Generate click, four soft drops as the groups arrive, one soft impact on "Nothing overlaps.", a switch sound for the simulator, one bong for the SPOF badge, a soft impact as the outro opens, a bell on the logo.
- Restraint rule: no SFX on every node, nothing above 0.7 volume, no riser or whoosh stack.

## Storyboard

### Scene 1 — Prompt — 3.3s (0.0-3.3, morph to 3.85)
Dark ground with the landing hero's purple and blue glows. "Describe anything." blurs in word by word (hero size, ~60% of the frame width). The prompt bar fades up under it showing the real placeholder ("Describe architecture (e.g. 'Uber LLD' or 'E-Commerce Microservices')..."). At 0.95s the typing begins: "E-Commerce Microservices", 24 characters at 0.06s each. The cursor glides to the Generate button and clicks on the 3.27s beat.
Sequential/interaction: yes — typed prompt, cursor move and click. Hold on the finished prompt about 0.9s before the click.
Audio intent: quiet and expectant, then a crisp click.
Audio-coupled idea: soft keypress ticks while typing, click on the press.
Music: warm bed fading in.
Transition mood: object becomes the world → Scene 2 (the prompt bar grows into the canvas window).

### Scene 2 — Build — 5.5s (3.27-8.74, caption holds to 10.4)
The window opens from the prompt bar's shape. Status chip: "E-Commerce Microservices · Thinking" then "Laying out". Four groups arrive on the beat: Clients (Web app "Storefront", Mobile app "iOS · Android"), Edge (CDN, API gateway "Authn · rate limits"), Services (Auth service "JWT · OAuth", Catalog service, Order service, Payment service "Stripe"), Data (PostgreSQL "Orders & users", Redis "Sessions · cache", Elasticsearch "Product search", Kafka "Order events"). Connectors draw in after their endpoints exist, labels pop in. On the 8.74s strong cue everything settles and the caption "Nothing overlaps." lands (about 1.6s settled).
Sequential/interaction: yes — groups reveal one by one on beats (4.39, 5.45, 6.56, 7.64), nodes stagger inside a group, connectors draw after. Node labels are a few words each, so the group beat (about 1.05s) is the hold floor.
Audio intent: soft drops on each group, one warm impact on the cue.
Audio-coupled idea: group-by-group card sequence, accent on each group arrival.
Music: bed continues.
Transition mood: clean → Scene 3 (same canvas, nothing cuts)

### Scene 3 — Live — 7.8s (9.3-17.0)
Same canvas. "Teammates, live." (1.8s hold): Aarav and Meera arrive with named cursors, their selection rings land on Catalog service and Order service, Aarav's ring then moves to Auth service. "Watch it run." (1.4s hold): the "Simulating traffic" HUD rises with speed controls 0.5× 1× 2×; cyan packets run along every arrow, amber along the async OrderPlaced link. "Catch single points of failure." (2.1s hold): the amber SPOF badge pings on the API gateway, the tooltip reads "API gateway has 2 dependent clients and 0 replicas", the HUD button turns red: "1 SPOF".
Sequential/interaction: yes — cursors travelling, selection ring moving between nodes, packets flowing, badge pinging 3 times.
Audio intent: a switch click for the simulator, one bong for the badge.
Audio-coupled idea: toggle sound when the HUD appears.
Music: bed continues.
Transition mood: the window drops back with a blur swap → Scene 4

### Scene 4 — Scale and lockup — 6.6s (16.6-23.2)
Blur-swap in on the strong cue at 17.47s: the real generated architecture diagram in a card on the right, zoomed in to legible nodes, then zooming out over 1.4s to show the whole sprawling system. Left: "Draw it." (17.47), "Generate it." (18.02), "Write it as code." (18.56) stacked, held until ~20.3s. Everything drops back and the lockup lands: logo, SLATE, "Think. Draw. Collaborate.", CTA "Start Free Workspace". Final lockup holds about 2.6s.
Sequential/interaction: yes — three lines stagger in on beats; each line is 2-4 words (hold at least 1.7s for the last).
Audio intent: a soft impact as it opens, a bell on the logo, music tail fades out.
Audio-coupled idea: bell on the logo landing.
Music: fade out over the last 1.8s.
Transition mood: blur swap, then dip back for the lockup.

**Music mood for this video:** upbeat but restrained
**Audio summary:** a warm steady bed with a handful of soft, motion-matched accents (typing, click, four drops, one impact, switch, bong, impact, bell).

## Grounding notes
- Prompt text and placeholder, "Think. Draw. Collaborate.", "Start Free Workspace", "slate.app/canvas", "Realtime Connected": landing page (`app/page.tsx`).
- "Draw it. Generate it. Write it as code.": README tagline ("draw it, generate it with AI, or write it as code").
- Node names, subtitles, group names, connector labels: the built-in "Microservices e-commerce" template (`lib/diagram/templates.ts`). Two nodes from that template (Fulfilment worker, Email provider) are dropped so the board stays readable at 1080p.
- "Thinking" / "Laying out": AI panel phases (`components/ai-panel/ai-panel.tsx`).
- "Simulating traffic", speeds 0.5× 1× 2×, "N SPOF", tooltip wording, amber badge, cyan dot: `components/canvas/TrafficSimulator.tsx`; message format from `lib/simulation/topology.ts`.
- Cursor shape and name flag: `components/canvas/CursorsOverlay.tsx`.
- "Nothing overlaps." paraphrases the README claim "the browser lays it out with ELK so nothing overlaps". "Teammates, live." / "Watch it run." are framing lines, not product claims.
- Aarav and Meera are fictional stand-ins. No emails, tokens or real user data appear anywhere.
