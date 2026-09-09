---
name: Temperature Alarms
description: Calm, factual monitoring for network closets; dark by default, numbers first, colour only as a signal.
colors:
  console-black: "oklch(0.145 0 0)"
  panel-grey: "oklch(0.205 0 0)"
  raised-grey: "oklch(0.269 0 0)"
  readout-white: "oklch(0.985 0 0)"
  primary-ink: "oklch(0.922 0 0)"
  dimmed-grey: "oklch(0.708 0 0)"
  hairline: "oklch(1 0 0 / 10%)"
  input-hairline: "oklch(1 0 0 / 15%)"
  focus-grey: "oklch(0.556 0 0)"
  signal-blue: "oklch(0.488 0.243 264.376)"
  humidity-green: "oklch(0.696 0.17 162.48)"
  critical-red: "oklch(0.704 0.191 22.216)"
  critical-fill: "oklch(0.505 0.213 27.518)"
  high-red: "oklch(0.637 0.237 25.331)"
  warning-amber: "oklch(0.769 0.188 70.08)"
  moderate-yellow: "oklch(0.852 0.199 91.936)"
  mdf-sky: "oklch(0.685 0.169 237.323)"
  daylight-white: "oklch(1 0 0)"
  daylight-ink: "oklch(0.145 0 0)"
  daylight-muted: "oklch(0.97 0 0)"
  daylight-dimmed: "oklch(0.556 0 0)"
  daylight-hairline: "oklch(0.922 0 0)"
typography:
  display:
    fontFamily: "system-ui, Avenir, Helvetica, Arial, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  headline:
    fontFamily: "system-ui, Avenir, Helvetica, Arial, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "system-ui, Avenir, Helvetica, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "system-ui, Avenir, Helvetica, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, Avenir, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary-ink}"
    textColor: "{colors.panel-grey}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.console-black}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.raised-grey}"
  button-ghost:
    textColor: "{colors.readout-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.raised-grey}"
  button-destructive:
    backgroundColor: "{colors.critical-fill}"
    textColor: "{colors.daylight-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  input:
    backgroundColor: "{colors.raised-grey}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.panel-grey}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.xl}"
    padding: "24px"
  tile:
    backgroundColor: "{colors.panel-grey}"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.xl}"
    padding: "16px 20px"
  badge-online:
    backgroundColor: "{colors.humidity-green}"
    textColor: "{colors.humidity-green}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
  badge-condition:
    backgroundColor: "{colors.warning-amber}"
    textColor: "{colors.warning-amber}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  badge-critical:
    backgroundColor: "{colors.critical-fill}"
    textColor: "{colors.daylight-white}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  nav-item:
    textColor: "{colors.readout-white}"
    rounded: "{rounded.md}"
    padding: "8px"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.raised-grey}"
---

# Design System: Temperature Alarms

## 1. Overview

**Creative North Star: "The Night Shift Console"**

A console read on the night shift: dark by default, the readouts first, and every light on the board there because it means something. The surfaces are pure greys at three depths, the type is the operating system's own sans, and the biggest thing on any screen is a number. Nothing decorates. When every closet is comfortable the page is almost monochrome; a Condition is the loudest thing on it, and the worst active Condition sets the tone of its card. This is the visual form of PRODUCT.md's *quiet until it matters* and *calm, factual, trustworthy*.

The system explicitly rejects the SaaS analytics dashboard (gradient accents, hero metrics, decorative charts), the consumer smart-home app (big rounded tiles, playful icons, weather-app styling), the industrial SCADA console (dense monochrome grids, tiny text, blinking indicators), and the old PHP and Bootstrap version of this site. It is a shadcn/ui set used plainly, in Tailwind v4, with the tokens in `frontend/src/index.css` as the single source of colour and radius.

Density is moderate: three pages (Dashboard, History, Settings) behind an inset sidebar, page sections 24px apart, cards padded 20 to 24px, tables at 14px with tabular figures. A light theme exists with the same structure; dark is what ships by default and what the palette below is written for.

**Key Characteristics:**
- Dark, chroma-zero surfaces at three depths; colour appears only as a signal.
- Numbers are the display type: 48 to 60px, semibold, tabular, tight tracking.
- One sans family (the system stack) at every size; a mono only for Device hostnames.
- Hairline borders and tonal steps carry depth; the page itself casts no shadows.
- Standard shadcn shapes, 8px radius on controls and 14px on cards, no decoration.
- Motion states a change (a fade-in, a spinning refresh icon) and never performs.

## 2. Colors: The Console Palette

Greys carry everything; colour is a signal, and each signal colour has exactly one meaning.

### Primary
- **Primary Ink** (`oklch(0.922 0 0)`): the near-white fill of the one primary button on a screen (Save token, Add) and text selection. In this system the primary is a grey; there is no brand hue on buttons.
- **Signal Blue** (`oklch(0.488 0.243 264.376)`): the sidebar mark and the temperature line on charts. It is the only blue, and it never fills a button or a badge.

### Neutral
- **Console Black** (`oklch(0.145 0 0)`): the page background and the fill of outline buttons.
- **Panel Grey** (`oklch(0.205 0 0)`): cards, tiles, the sidebar, popovers and dialogs. One step up from the page.
- **Raised Grey** (`oklch(0.269 0 0)`): muted and accent surfaces: hover fills, input backgrounds, the active nav item, table header on hover. Two steps up.
- **Readout White** (`oklch(0.985 0 0)`): all primary text and the big numbers.
- **Dimmed Grey** (`oklch(0.708 0 0)`): secondary text: labels above numbers, table captions, timestamps, the unit after a number. It meets 4.5:1 on Panel Grey; do not go lighter.
- **Hairline** (`oklch(1 0 0 / 10%)`): every border on the page: cards, table rows, the dashed empty-state panel. **Input Hairline** (`oklch(1 0 0 / 15%)`) is the same idea on inputs and outline buttons.
- **Focus Grey** (`oklch(0.556 0 0)`): the ring colour at 50% alpha, 3px, on every focused control.

### Signal colours (Conditions and state)
These are the Tailwind v4 palette values the Condition looks in `frontend/src/lib/conditions.ts` use. Each is a tint (15 to 20% alpha fill, coloured text) except critical, which is solid.
- **Critical Red** (`oklch(0.704 0.191 22.216)`): the `destructive` token, tuned to read on dark grey: error text, error icons, and the border of a critical card. Never a fill under text.
- **Critical Fill** (`oklch(0.505 0.213 27.518)`): the `destructive-solid` token, the only red that goes under white text: the critical Condition badge and the confirm button of a destructive dialog. White on it is 6.4:1; white on Critical Red is 2.9:1, which is why the two exist. In the light theme both are the same red.
- **High Red** (`oklch(0.637 0.237 25.331)`): Mold risk at the high level: tinted badge and a 70% border.
- **Warning Amber** (`oklch(0.769 0.188 70.08)`): Hot, Cold, Dry and Offline at warning, the "Reconnecting" stream status, and the warn tone on a tile's note. Tinted badge and a 70% border.
- **Moderate Yellow** (`oklch(0.852 0.199 91.936)`): Mold risk at the moderate level only. A heads-up the card shows and the summary does not count.
- **Humidity Green** (`oklch(0.696 0.17 162.48)`): the Online badge, the "Live" stream dot, and the humidity line on charts.
- **MDF Sky** (`oklch(0.685 0.169 237.323)`): the outline tag that marks a Main Distribution Frame. IDF tags stay grey.

### Light theme
The same roles on **Daylight White** (`oklch(1 0 0)`) with **Daylight Ink** (`oklch(0.145 0 0)`) text, **Daylight Muted** (`oklch(0.97 0 0)`) for raised surfaces, **Daylight Dimmed** (`oklch(0.556 0 0)`) for secondary text and **Daylight Hairline** (`oklch(0.922 0 0)`) for borders. Signal colours keep their hue and shift to the 700 and 800 steps for text so they still read on white.

### Named Rules
**The One Meaning Rule.** A signal colour is bound to one Condition level or one state and is never used for emphasis, decoration, or brand. Amber means warning wherever it appears; if it appears anywhere else, it is wrong. A confirmation tick is grey, not green: green means Online.

**The Two Reds Rule.** No mid-luminance red reads both as text on dark grey and as a fill under white. Critical Red is for text and borders, Critical Fill for solid surfaces; swapping them fails AA in the dark theme.

**The Worst Wins Rule.** A card takes the border of its worst active Condition and only that one. Badges list every Condition; the border says which matters most.

**The Grey Button Rule.** Primary actions are near-white on dark, not blue. The only blue on a screen is the sidebar mark and a chart line, so a technician's eye is never pulled to a button when it should be on a number.

## 3. Typography

**Display Font:** system-ui (with Avenir, Helvetica, Arial, sans-serif)
**Body Font:** system-ui (the same stack)
**Label/Mono Font:** ui-monospace (with SFMono-Regular, Menlo, Consolas) for Device hostnames only

**Character:** one family, the operating system's own, from 12px labels to 60px readouts. Weight and tabular figures do the work a second family would; the numbers are the display type and everything else defers to them.

### Hierarchy
- **Display** (semibold 600, 3rem to 3.75rem, line-height 1, tracking -0.025em, tabular figures): the latest temperature on a Device card, sized to be read from across a room. Its unit follows at 1.5 to 1.875rem in Dimmed Grey. The humidity readout is the same treatment at 1.875 to 2.25rem.
- **Headline** (bold 700, 1.875rem, tracking -0.025em): the page title, once per page: Dashboard, Settings, or the Closet name on History.
- **Title** (semibold 600, 1.125rem, line-height 1.25): the Closet name on a card and card titles. Tile values are semibold 1.875rem, tabular.
- **Body** (regular 400, 0.875rem, line-height 1.5): everything else: table cells, descriptions, dialog copy, notes. Inputs are 1rem on touch widths and 0.875rem from `md` up. Prose is capped by `max-w-sm` in placeholders and reads under 65ch.
- **Label** (medium 500, 0.75rem, sentence case): the word above a readout or tile value, badge text, the note under a tile. Never uppercase, never tracked.
- **Mono** (regular 400, 0.875rem): `ESP_A1B2C3`, and nothing else.

### Named Rules
**The Tabular Rule.** Any number that can change while it is on screen is set `tabular-nums` so it does not jitter when it changes. Ages, countdowns, readouts, table columns, tile values.

**The Sentence Case Rule.** Headings, labels, buttons and badges are sentence case. No uppercase tracked eyebrows anywhere.

## 4. Elevation

Flat and tonal. Depth on the page comes from three grey steps (Console Black, Panel Grey, Raised Grey) and hairline borders at 10% white; nothing on the page itself casts a shadow. Cards carry Tailwind's `shadow-sm` and outline buttons `shadow-xs`, both invisible on dark and a whisper on light, kept only so the shadcn primitives stay stock. Overlays are the exception: dialogs, menus and popovers float on Panel Grey with a real shadow because they sit above the page rather than in it.

### Shadow Vocabulary
- **Resting** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): cards and outline buttons at rest. Present for consistency, not for depth.
- **Overlay** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): dialogs and dropdown menus, the only things allowed to float.

### Named Rules
**The Three Greys Rule.** Page, panel, raised. If a surface needs a fourth depth, the layout is wrong, not the palette.

**The Nothing Floats Rule.** Shadows appear only on overlays. A hover never lifts a card; it changes a fill (Raised Grey) or a text colour.

## 5. Components

Plain and precise: stock shadcn/ui shapes, 8px radius on controls and 14px on containers, no decoration. The content is the design.

### Buttons
- **Shape:** gently rounded (8px), 36px tall, 14px medium text, 8px gap to a 16px icon. Small is 32px with 12px padding; icon-only is a 36px square. Under a coarse pointer (`pointer-coarse:`) every button, input, select, tab, and the sidebar trigger grows to at least 44px; under a mouse the density above stands.
- **Primary:** Primary Ink fill with Panel Grey text, 8px by 16px padding. Hover drops the fill to 90%. One per view at most.
- **Outline:** Console Black fill, Input Hairline border, Readout White text. Hover fills Raised Grey. The default for every secondary action: Refresh, Try again, Previous and Next day, Cancel.
- **Ghost:** no fill or border; hover fills Raised Grey at 50%. Inline actions in a row of text: Change, Forget, Today.
- **Destructive:** solid Critical Fill with white text; used only as the confirm button inside a destructive dialog. The trigger for a destructive flow is an Outline button with Critical Red text.
- **Focus:** a 3px ring in Focus Grey at 50% plus the border turning to the ring colour. Disabled is 50% opacity with pointer events off.

### Chips (badges)
- **Style:** 8px radius, 12px medium text, 2px by 8px padding, a 12px icon before the word where one helps (Wifi, WifiOff).
- **Condition badge:** tinted fill at 15% (20% on dark) with the level's colour as text; the name in semibold and the level after a middle dot at normal weight and 80% opacity. Padded up to 4px by 10px and 14px text so it reads at a distance. Critical is solid Critical Fill with white text.
- **Online badge:** Humidity Green tint with green text and the Wifi icon. Offline uses the warning look with WifiOff.
- **Tag:** outline variant in Readout White for IDF; MDF Sky border and tint for MDF.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** Panel Grey with Readout White text.
- **Shadow Strategy:** resting shadow only; see Elevation.
- **Border:** Hairline at rest; a Condition card swaps it for the worst level's colour at 70%, or solid Critical Red.
- **Internal Padding:** 24px vertical and horizontal on a standard card; a Device card and a tile use 20px horizontal with 20px and 16px vertical.
- **Device card (signature):** Campus name in Dimmed Grey above the Closet name in Title, the tag beside it and the Online badge on the right; the temperature Display and humidity readout side by side; a row of Condition badges; a footer with the age of the last Reading, the countdown to the next, and an outline History button. The border is the worst Condition.
- **Tile:** a `dl` entry: 14px Dimmed Grey label, 1.875rem semibold tabular value, a 12px note beneath that turns Warning Amber when it carries a warning.
- **Placeholder:** the empty and error state for a region: a dashed Hairline border, 14px radius, 64px vertical padding, centred: a medium heading, a Dimmed Grey sentence under 65ch, and one outline action.

### Inputs / Fields
- **Style:** 36px tall, 8px radius, Raised Grey fill at 30% on dark (transparent on light), Input Hairline border, 12px horizontal padding, placeholder in Dimmed Grey.
- **Focus:** the same 3px Focus Grey ring as buttons.
- **Error / Disabled:** `aria-invalid` turns the border Critical Red with a red ring at 20 to 40%; disabled is 50% opacity with a not-allowed cursor.
- **Native date field:** styled to match the input (same height, border, radius, tabular text) so day navigation reads as one control group with its Previous and Next buttons.

### Navigation
- **Style:** an inset sidebar on Panel Grey, collapsible to icons; the district mark is a 32px Signal Blue rounded square with a white icon, the district name in medium 14px and the product name in 12px beneath.
- **Items:** 32px tall, 8px radius, a 16px Lucide icon and a 14px label; hover fills Raised Grey at 50%, the active route fills Raised Grey. Router links, so navigation never reloads.
- **Mobile:** the sidebar becomes a sheet behind the trigger in the 64px header; pages stack to one column and grids collapse with `auto-fill, minmax(17rem, 1fr)`.

### Charts
- Recharts inside the shadcn ChartContainer. Temperature in Signal Blue and humidity in Humidity Green, dashed, on two axes; grid lines are Hairline at 50%; ticks are 12px Dimmed Grey; the day runs midnight to midnight. No dots above 48 points, no fill areas, no animation on live reloads.

### Motion
Motion states a change and never performs. The vocabulary lives in `frontend/src/lib/motion.ts` and the easing tokens in `index.css`: a change settles out on an exponential ease (`--ease-out-quint`, 200ms), an exit is quicker (150ms), and nothing bounces.
- **A Reading landing (signature):** the card's fill rises to Raised Grey and settles back over 800ms (`animate-reading-landed`, expo ease, held for the first quarter) while NumberFlow counts the readout. Grey, not a signal colour: it says which closet just spoke, not how it is.
- **State in place crossfades:** the Online and Offline badges, the "Next in" and "Expected ago" notes, Condition badges arriving and leaving (with a layout shift on their siblings), and the Live dot's colour. A card's border colour transitions over 300ms when its worst Condition changes.
- **Arrival:** a page's content fades in from its skeleton over 200ms; Device cards arrive with a 6px rise, 30ms apart, capped at the eighth so a long grid never waits. Settings rows fade in when added and out when deleted; a status line fades in when it lands. No page-load choreography beyond that.
- **Routes:** 220ms fade with an 8px rise in, 120ms fade out, `mode="wait"`.
- **Feedback:** `active:scale-[0.98]` over 150ms on every button; `animate-spin` on the Refresh icon while a reload is in flight; `animate-pulse` on the Reconnecting dot.
- **Reduced motion:** CSS animations are gated by `motion-safe:` and a global `prefers-reduced-motion` rule collapses every duration; framer-motion runs under `MotionConfig reducedMotion="user"`, which drops transforms and layout moves and keeps crossfades, so a state change is still visible as a fade.

## 6. Do's and Don'ts

### Do:
- **Do** set every changing number in `tabular-nums` and size the latest temperature at 48 to 60px semibold; the number is the design.
- **Do** keep colour to its one meaning: Warning Amber for warning, High Red for high, Critical Fill under white for critical, Moderate Yellow for moderate, Humidity Green for Online and Live, Signal Blue for the mark and the temperature line.
- **Do** give a card the border of its worst active Condition and list every Condition as a badge with its level spelled out; a colour is never the only signal.
- **Do** use the Placeholder pattern (dashed Hairline, 64px padding, one outline action) for every empty and error state, and a Skeleton for loading; never a spinner in the middle of content.
- **Do** use outline buttons for secondary actions, ghost buttons for inline ones, one primary per view, and put every destructive action behind an AlertDialog whose confirm is the only destructive-filled button.
- **Do** keep text at 14px or larger in tables and body, Dimmed Grey no lighter than `oklch(0.708 0 0)` on Panel Grey, and a visible 3px focus ring on every control.
- **Do** write labels, buttons and badges in sentence case, in the vocabulary of CONTEXT.md (Device, Reading, Campus, Closet, Condition).
- **Do** size every control to 44px under `pointer-coarse:` and leave the mouse density alone; the finger is the case, not the viewport width.
- **Do** give every page one h1 and a document title of its own ("Settings · Temperature Alarms"), and keep the sidebar links inside the `nav` landmark.

### Don't:
- **Don't** build a SaaS analytics dashboard: no gradient accents, no hero-metric tiles with sparklines, no decorative charts, no marketing polish on an internal tool.
- **Don't** build a consumer smart-home app: no big rounded tiles, no playful icons, no weather-app styling.
- **Don't** build an industrial SCADA console: no dense monochrome grids, no text under 12px, no blinking indicators. A pulsing red border was removed from `index.css` for this reason and must not come back.
- **Don't** reproduce the old PHP and Bootstrap version: no default Bootstrap look, no generic admin template, no Font Awesome.
- **Don't** put a coloured `border-left` or `border-right` stripe on anything; a Condition is a full border, a tint, or a badge.
- **Don't** use Signal Blue on a button, a badge, or a link; it belongs to the mark and the chart.
- **Don't** lift a card on hover or add a shadow to anything that is not an overlay.
- **Don't** compute a Condition, a threshold, or a colour rule in the browser; render what the API sends.
- **Don't** add uppercase tracked eyebrows, numbered section markers, gradient text, or glass effects anywhere.
- **Don't** animate layout properties, orchestrate page-load sequences, or ship any animation without a reduced-motion alternative.
