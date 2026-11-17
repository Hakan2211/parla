# Parla — UI/UX design prompts (for GPT Image)

How to use: paste the **Style system** block first, then one screen prompt.
Generate each screen at **1536×960 (16:10)** so mockups match the desktop
window. Reuse your best output as a reference image for the remaining screens.
That does more to keep the set consistent than any wording.

The direction builds on what Parla already is (warm editorial: cream paper,
ink type, terracotta "ember" accent, a living orb) and pushes it toward
"calm, premium, made by people who care." The aim is less "AI dashboard" and
more a beautifully set book that listens.

---

## Style system (prepend to every prompt)

```
Flat, pixel-perfect desktop app UI screenshot, no device frame, no perspective,
no hands, no watermark. App name "Parla", a voice companion you talk to for hours.
Visual language: warm editorial minimalism, like a high-end literary magazine
crossed with a modern meditation app. Background warm cream paper #F4F1EA with a
barely visible paper grain; panels slightly lighter #FAF8F3; primary text deep ink
#2B2A26; secondary text #6B675E; hairline dividers at 8% ink opacity. Single accent
color: ember terracotta #BF5F3D (deep variant #A04A2C), used sparingly for the one
primary action and live states. Typography: elegant high-contrast serif for
headlines (like Canela or GT Super), clean humanist sans for UI labels (like Inter
or Söhne), tiny uppercase letter-spaced eyebrow labels. Generous whitespace,
8px grid, 14–20px corner radii, soft long shadows at low opacity, frosted-glass
cards (white at 55% with blur). Icons: thin 1.5px line icons, rounded caps.
No gradients except the orb's glow. No stock photos, no emoji, no clutter.
All text must be crisp, correctly spelled, and legible.
```

---

## 1. Home: "A quiet moment" (idle, before talking)

```
Main window of Parla, idle state. Three-column layout: left sidebar 260px, center
stage, right conversation panel 360px (collapsed into a slim empty state).
LEFT SIDEBAR: wordmark "Parla" in serif at top; nav items with line icons: "Talk",
"Personas", "Memory", "Settings"; below, a section labelled "RECENT" with 5
conversation cards, each showing a serif title ("Trading fear and anxiety",
"Weekend hike plans", "Sister's visit to Berlin"), a two-line grey summary, and a
tiny right-aligned meta line "$0.0042 · Today".
CENTER STAGE: tiny letter-spaced eyebrow "NOVEMBER 17, 2026"; large serif headline
"A quiet moment"; a thin divider with a small ember diamond; italic serif subline
"Take a breath, then start when you're ready." In the middle, a large softly
glowing 3D orb (about 380px): matte translucent sphere with slow flowing
terracotta, peach and cream light inside, like warm liquid glass, soft halo
around it. Below the orb, a persona selector: three pill chips with small colored
dots, "The Friend" (selected, violet dot), "The Coach" (amber), "The Thinker"
(green). Below that, one large ember pill button with a microphone icon:
"Start talking". Subtle hint text under it: "Press Space to talk".
Mood: serene, inviting, expensive.
```

## 2. Live session: listening / thinking / speaking (make 3 variants)

```
Parla during a live voice conversation with "The Friend". Same three-column
layout. CENTER: eyebrow "LIVE · 12:48"; serif headline "Talking with The Friend";
the orb is now animated and reacting to voice. Variant A "LISTENING": the orb
breathes gently with cool cream highlights and a thin ring of ember particles
tracing the user's voice level. Variant B "THINKING": the orb's inner light
swirls slowly inward, slightly dimmer, three faint orbiting points. Variant C
"SPEAKING": the orb pulses outward in warm terracotta waves synced to speech.
Small uppercase state label under the orb: "LISTENING" / "THINKING" / "SPEAKING".
BOTTOM CONTROL BAR, centered floating frosted-glass capsule: ember circular mic
button (active), a live 28-bar audio waveform, elapsed timer "12:48", a hairline
separator, then a live cost readout in monospace "$0.0123 · 4.2k tok", then a
circular outlined stop button. RIGHT PANEL titled "Conversation" with a green
"live" dot: chat transcript as soft bubbles. User bubbles warm sand #F0E8D8
right-aligned labelled "You · 12:46", assistant bubbles light stone #EFECE5
left-aligned labelled "The Friend · 12:46"; the newest assistant bubble is
streaming with a soft caret. TOP-LEFT tiny frosted latency card in monospace:
"voice → voice 640ms · p50 702ms".
```

## 3. Conversation detail with per-session cost

```
Parla, a past conversation opened from the sidebar. Center column only (reading
layout, max width 720px). Eyebrow "NOVEMBER 16, 2026 · 9:14 PM". Big serif title
"Trading fear and anxiety". Italic serif summary paragraph, 2 lines. Below, a
frosted stats strip with five evenly spaced metrics, each with a tiny uppercase
label above a monospace value: "LENGTH 23 min", "COST (API-EQUIV.) $0.0312",
"TOKENS 18k", "YOU SPOKE 11 min", "SAVED VS CLOUD VOICE $1.87" (this one has a
small leaf icon and ember value). Thin ember diamond divider. Then the full
transcript in book-like typography: alternating speaker names in small caps,
generous line height, a faint latency badge "612ms" after assistant lines, an
interrupted line marked with an italic "— interrupted". Right edge: a slim
vertical timeline scrubber with topic markers.
```

## 4. Settings: Usage & cost dashboard

```
Parla Settings page, section "Usage & cost" at the top. Four frosted stat cards
in a row: "TODAY $0.04", "7 DAYS $0.31", "30 DAYS $1.12", "ALL TIME $3.86", each
with a grey sub-line like "212k tokens · 6.4 h of voice". Below, a quiet sentence:
"Speech recognition and voice run on your GPU for $0. The same audio on cloud APIs
would have cost about $41.20." Then a minimal bar chart of daily spend for the
last 30 days with thin ember bars and a dotted average line. Then a clean table
"By model" with columns Model, Sessions, Tokens, Cost; rows "claude · claude-sonnet-5",
"openrouter · google/gemini-2.5-flash", "lmstudio · gemma-4-26b-a4b (local, $0)".
Then an "API key" card: masked key "sk-or-…a91f", status pill "Connected", text
"Key used $2.14 · $7.86 left of $10.00 limit", a thin progress bar in ember, and a
small outlined button "Refresh balance". Further down, collapsed section headers
"AI provider", "Voice engine", "Speech recognition". Elegant, trustworthy, like a
banking app designed by a bookshop.
```

## 5. Settings: AI provider & voice engine chooser

```
Parla Settings, "AI provider" section expanded. Three large selectable cards in a
row, each with an icon, name, one-line description and three small spec chips:
"Claude": "Best conversation quality", chips "~1.0s first word", "API-equiv. $0.001/turn",
"Uses your Claude login"; "OpenRouter": "Fastest cloud", chips "~0.3s", "$0.0002/turn",
"API key"; "Local": "Private, runs on your GPU", chips "~0.2s", "$0", "Offline".
The selected card has an ember border and a check. Below, a "Voice" section:
horizontally scrolling voice cards, each with a circular abstract avatar, voice
name ("Heart", "Michael", "Emma", "Designed voice…"), language tag, and a small
play button with a mini waveform preview. A third section "Speech recognition"
with a segmented control "English (fastest) | Multilingual".
```

## 6. Personas gallery + editor

```
Parla Personas page. Left: a grid of persona cards (3 columns). Each card has an
abstract generative portrait (soft painted shapes in the persona's color, no human
face), the persona name in serif ("The Friend", "The Coach", "The Thinker",
"The Storyteller"), a one-line vibe ("warm, curious", "direct, energizing"), and
the voice name with a tiny play icon. A dashed "+ New persona" card. Right: an
editor panel for the selected persona: name field, color swatches, "Voice"
dropdown with preview button, a large "Personality" text area with serif text,
sliders "Talkativeness", "Warmth", "Challenge", a toggle "Private memory for this
persona", and an ember "Save" button.
```

## 7. Memory: "What Parla knows about you"

```
Parla Memory page. Serif headline "What Parla remembers"; subline "Everything here
came from your conversations. Edit or forget anything." Filter chips: "All",
"Facts", "People", "Open threads", "Commitments". Content as an elegant masonry of
index-card style notes on cream paper, each with a tiny uppercase kind label, the
memory in serif ("Ana — your sister, lives in Berlin, visiting in December"), an
importance indicator of 1–5 small ember dots, a source link "from: Sister's
visit · Nov 12", and hover actions "Edit" and "Forget". A "Commitments" card
shows a due-date pill "Tue". Calm, personal, like a notebook a friend keeps.
```

## 8. First run / engine loading

```
Parla splash and first-run screen, centered on cream paper. Large serif wordmark
"Parla", tiny letter-spaced "VOICE COMPANION". Below, a vertical checklist with
soft animated states: "Speech recognition: Parakeet, ready" (check), "Voice:
Kokoro, warming up" (ember spinner), "Conversation: Claude, connected" (check),
"Microphone: allowed" (check). A thin progress line. At the bottom, a hint:
"Everything you say is transcribed on this computer." Minimal, reassuring.
```

## 9. Dark mode ("Evening") variant of screen 2

```
Same as the live session screen, but in an evening dark theme: background deep
warm charcoal #1A1816, panels #221F1C, text warm ivory #EDE6DA, secondary #9C9486,
accent ember #D2714C glowing softly. The orb glows like a coal in a fireplace.
Keep the editorial serif headlines and all labels. Cozy, low-light, not neon.
```

## 10. Assets

```
App icon for "Parla", macOS/Windows style rounded square, 1024×1024: a single
luminous terracotta orb with a soft inner swirl on a cream background, subtle
paper texture, minimal, no letters.
```

```
Set of 4 abstract persona portraits, 512×512 each, painterly soft-edged shapes,
no faces, no text: violet for "The Friend" (warm, open circles), amber for
"The Coach" (strong upward diagonals), green for "The Thinker" (calm concentric
rings), indigo for "The Storyteller" (flowing ribbons). Same cream paper background.
```

---

## UX principles to hold the mockups to

1. **One primary action per screen.** Ember marks it, and nothing else is ember.
2. **The orb is the interface.** State (listening, thinking, speaking) must be readable from across the room without text.
3. **Show cost honestly and quietly.** Always visible, never alarming. Say how each number was obtained (provider-reported, priced, local, subscription-covered).
4. **Privacy is a feature.** Say "on this computer" wherever it's true.
5. **Keyboard first.** Space to talk, Esc to end, ⌘/Ctrl+K for search.
