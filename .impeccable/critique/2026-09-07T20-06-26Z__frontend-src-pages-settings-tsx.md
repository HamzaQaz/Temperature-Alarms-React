---
target: frontend/src/pages/Settings.tsx
total_score: 29
p0_count: 0
p1_count: 3
timestamp: 2026-09-07T20-06-26Z
slug: frontend-src-pages-settings-tsx
---
Method: dual-agent (A: design review · B: detector and browser evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | "Admin token saved" is unverified until a change fails; no confirmation after an add or delete, and focus drops to body |
| 2 | Match System / Real World | 4 | n/a: ".env", "printed to serial on boot", CONTEXT.md vocabulary throughout |
| 3 | User Control and Freedom | 2 | No edit: the only correction is delete and re-add, which destroys Readings; the Not authorised panel has no Cancel |
| 4 | Consistency and Standards | 3 | Mobile dialog stacks Delete above Cancel; desktop is Cancel then Delete |
| 5 | Error Prevention | 2 | The Campus delete dialog says a Campus with Devices cannot be deleted, then lets you confirm and fail |
| 6 | Recognition Rather Than Recall | 3 | Disabled Add and Delete give no reason at the point of use; the `title` tooltip never shows because disabled buttons have no pointer events |
| 7 | Flexibility and Efficiency | 2 | One add per open-and-close cycle; no edit, sort, or search |
| 8 | Aesthetic and Minimalist Design | 4 | n/a: three greys, nothing decorative, one primary per view |
| 9 | Error Recovery | 3 | Form and values survive a 401; the delete error sits above the table, detached from its row |
| 10 | Help and Documentation | 3 | Good hints; the hostname error replaces the "printed to serial" hint at the moment it is needed |
| **Total** | | **29/40** | **Good** |

## Anti-Patterns Verdict

**LLM assessment:** clean. No side stripes, gradient text, glass, hero-metric tiles, identical card grids, uppercase eyebrows, or numbered markers. Stock shadcn used plainly, one primary action per view, mono only on hostnames. It reads as a hand-built internal tool, which is what PRODUCT.md asks for. The one tell is the sidebar typo "Temprature Monitor" (`frontend/src/components/app-sidebar.tsx:56`), visible on every page.

**Deterministic scan:** the CLI scan of `Settings.tsx`, `AdminTokenPanel.tsx`, and `components/settings/` returned zero findings. The in-page detector found 8 to 9 items per view:
- Real: `line-length` on the page intro (~112 chars), the token panel copy (~119), and the Campuses and Devices intros (~86 and ~96). At the page's `max-w-4xl` these paragraphs run well past 75ch.
- Out of scope: four `layout-transition` hits on `transition-[width]` in the shadcn sidebar shell, header, and body. The collapse animation, not Settings.
- False positives: `cramped-padding` and `nested-cards` on the bordered table wrapper and the token panel (the cells and the panel carry their own padding; the page has no Card).

**Visual overlays:** script injection succeeded and the detector ran in the page, but the browser was headless Playwright, so there is no user-visible overlay tab. The console output above is the evidence.

**Measured:** muted text is 7.7:1 on the page and 6.9:1 on panels, so every text colour clears AA. The smallest text is 12px, in the sidebar only; the page itself is 14px and up. No horizontal scroll at 390px. Under reduced motion every animation is 0s; only 150ms colour and shadow transitions on hover and focus remain, which is fine. Every focusable element has an accessible name. The page has no h1: the h2 "Settings" is the top of the outline.

## Overall Impression

A quiet, honest admin page that matches the register and the design system, with excellent copy and a best-in-class 401 recovery. What it lacks is closure and correction: a successful save ends in silence with focus on body, and the only way to fix a typo is to destroy the Device's history. The single biggest opportunity is the moment after Save.

## What's Working

- **The 401 recovery** (`frontend/src/hooks/use-change.ts`, `frontend/src/pages/Settings.tsx`): the token is cleared, the panel opens marked invalid with focus in the field, and the form and its values are preserved. "Nothing was changed." is exactly the reassurance needed.
- **Copy in the district's own words**: "The CHS filter disappears from the dashboard", "Paste the token from the server's .env", the Select showing "Central High School (CHS)".
- **Complete state coverage**: skeleton rows shaped like the data, an error row with Try again, an empty row with the next step, "Saving…" and "Deleting…" pending labels, and Escape returning focus to the trash button.

## Priority Issues

- **[P1] Focus and status are dropped after every save.** After Save token, Save campus, and Save device (`AdminTokenPanel.tsx`, `CampusesSection.tsx` closeForm, `DevicesSection.tsx` closeForm) the form unmounts and focus lands on body with nothing announced. Why it matters: keyboard and screen-reader users lose their place, and every user ends the task in silence. Fix: move focus to the section's Add button and render a `role="status"` line such as "ESP_A1B2C3 added". Suggested command: /impeccable harden
- **[P1] The Campus delete dialog confirms a promised failure.** The description says "A campus that still has Devices cannot be deleted" and then offers Delete anyway; confirming produces a 409 error above the table. Why it matters: a trap that contradicts its own copy. Fix: return a device count with each Campus and show "2 Devices" in place of the trash button, or disable it with the reason. Suggested command: /impeccable harden
- **[P1] No way to correct a Device without destroying its Readings.** Fixing "IDF 3" to "IDF 2" means delete and re-add. Why it matters: it destroys the history the product exists to keep. This is a product decision beyond a design pass (the rebuild spec scoped add and delete only), so it needs its own ticket: inline edit of Closet and Campus with the hostname immutable. Suggested command: /impeccable shape
- **[P2] Batch adding is one at a time.** The form closes on save and Add is disabled while it is open, so ten flashed boards mean ten open, fill, save cycles. Fix: after a successful save keep the form open, clear it, refocus the hostname field. Suggested command: /impeccable harden
- **[P2] Touch targets under 44px and a phantom focus stop.** At 390px the tabs are 29px tall, the delete buttons 32px square, and Add 32px tall; Radix `TabsContent` is tabbable with no visible ring; the submit buttons are disabled until valid so a keyboard user never lands on them. Fix: `min-h-11` on those controls at small widths, `tabIndex={-1}` on `TabsContent`, keep submits enabled and validate on submit. Suggested command: /impeccable audit
- **[P2] Intro paragraphs run past 100 characters a line.** Fix: `max-w-prose` (65ch) on the page intro, the token panel copy, and both section descriptions. Suggested command: /impeccable layout

## Persona Red Flags

**Alex (power user):** ten boards is ten click-Add cycles; no edit for a typo; no keyboard path to a disabled Save.

**Sam (screen reader, keyboard only):** focus dropped to body after every save; `TabsContent` phantom stop; disabled submits are skipped; the "Not authorised" heading is not announced (the input takes focus, the panel has no live region); no live region on success.

**Riley (stress tester):** the Campus-with-Devices delete that fails after confirming; the Not authorised panel has no Cancel, so only a reload escapes it; on mobile the Devices table scrolls the trash column off screen.

**Dana (district technician at a laptop, adding a newly flashed board):** the hostname hint is right, but a mistype replaces it with the error at the moment she needs it; after saving there is no confirmation and no link to the new card on the dashboard; a typo in Closet sends her into "Every Reading is deleted" for a Device that has none.

## Minor Observations

- Mobile dialogs put the destructive button first; desktop puts Cancel first.
- The delete error renders above the table rather than beside the row that failed.
- The delete dialog for a Device gives no scale: how many Readings, since when. For a just-added Device it frightens for nothing.
- Expected 401 and 409 responses log as console errors.
- The page has no h1; the sidebar app name is a span.

## Questions to Consider

- A district adds a Campus once a decade. Why is it a tab equal to Devices instead of a "New campus…" option inside the Add device Select?
- Should Delete be Retire: the Device stops showing, the Readings stay?
- Why type a shared secret into a browser field at all, versus trusting the district network the technician is already on?
