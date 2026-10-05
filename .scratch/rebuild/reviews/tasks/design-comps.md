Target: design comps (mockups) of new screens for Temperature Alarms, as self-contained HTML files under .scratch/design/comps/. These are concepts for the owner to choose from before anything is built, so no product code changes.

Use the impeccable skill. Run its context step, then read reference/shape.md and reference/new-work.md for how to frame concepts, and reference/craft-floor.md before writing the HTML. The world is DESIGN.md's "The Night Shift Console": render the comps in exactly that world (its tokens, type, radii, and its Do's and Don'ts), so they read as the same product. Read PRODUCT.md first. Note its open decision: a new, unnamed audience. The comps are partly how the owner will decide which audience to serve.

Produce four comps. Each one is a single HTML file with realistic data (fictional campuses and closets, believable Readings), designed at desktop 1440 px, with a 390 px phone version of the same file where the concept applies.
1. **Wall screen mode**: the Dashboard for an unattended NOC screen read from across the room. Every Campus at once, worst-first, with large readouts, a clear "all calm" state, and how a new Condition announces itself without blinking. Show two states side by side: all calm, and one closet critical.
2. **Campus overview**: a per-Campus summary for leadership. Each Campus as a row or block with counts per Condition, the worst closet, a 7-day trend of the worst daily high, and time since the last incident. Calm and factual: no SaaS hero metrics.
3. **Incident timeline**: a chronological log of Conditions starting and ending across the district, for "what happened overnight". Each incident shows its Device, its Condition and peak level, start, end, and duration, and links to History for that day.
4. **Facilities view**: Hot, Cold, Dry, and Mold risk framed for HVAC and facilities staff. Where the closet is (Campus, building, Closet), how long it has been out of range, the trend, and a plain-language "what to check". Network detail is hidden.

For each comp, add a short annotation panel (toggleable, off by default) naming the audience, the job, the key decision, and which DESIGN.md rules it relies on or would need to change. Include a subtle demo of the signature motion where it matters, for example the wall screen's new-Condition announcement and the timeline's new entry arriving, with a reduced-motion path.

Also write .scratch/design/comps/index.html, a gallery linking the four comps with one line each, so the coordinator can publish it as one artifact. Use relative links. Put any shared CSS in a file, or inline it. Load no external resources except Google Fonts if the world needed one; it does not, since it uses the system stack.

Verify: render each file in a headless browser (Playwright, already used by frontend/e2e) at 1440 and 390, save PNGs next to each comp, look at them once, fix what is off in one batch, and confirm once. Run `C:/Users/night/.claude/skills/impeccable/scripts/impeccable detect --json .scratch/design/comps` and fix its findings.

Constraints: edit nothing outside .scratch/design/comps/. Other workers are editing frontend/src, DESIGN.md, backend/scripts, compose.demo.yaml, deploy/, and README.md at the same time. Never commit, push, stash, reset, or checkout. Start no Docker stack (memory is tight).

Ownership: .scratch/design/comps/ only.

Observable acceptance: worker_done listing the comps with one line each on the concept and the key design decision, the detector result, and the PNG paths; --outcome succeeded if all four comps and the gallery render cleanly at both widths.
