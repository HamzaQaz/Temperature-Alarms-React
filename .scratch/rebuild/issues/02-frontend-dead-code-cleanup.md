# 02 — Frontend dead code and dependency cleanup

**What to build:**
The frontend contains only code and packages it actually uses, and navigating between pages no longer reloads the browser. The app looks and behaves exactly as before.

**Blocked by:** None — can start immediately

**Status:** done

- [x] Unused nav components, unused hooks, and unused helper modules are deleted
- [x] Bootstrap and Font Awesome are removed from dependencies
- [x] Only one of the two motion packages and one of the two number-flow packages remains, whichever is actually imported
- [x] The `radix-ui` meta-package is removed in favour of the individual packages actually imported, or vice versa, but not both
- [x] The sidebar navigates with router links, and the page transition animation visibly runs on navigation
- [x] Lint and typecheck pass with zero warnings
- [x] Dashboard, History, and Settings render and function as before

## Comments

- 2026-09-04: Implemented. Deleted the four `nav-*` components, `use-controlled-state`, `use-is-in-view`, `get-strict-context`, the never-consumed `useTheme` export (and with it the theme context nobody read; the provider now only applies the theme class), and the unreferenced Vite scaffold logo `assets/react.svg`. Removed `bootstrap`, `@fortawesome/fontawesome-free`, `motion` (only the deleted hook imported it; `framer-motion` stays), `number-flow` (only `@number-flow/react` is imported), and the `radix-ui` meta-package. Sidebar nav items are router `Link`s. Lint runs clean with `--max-warnings 0`; the react-refresh export rule is scoped off for `src/components/ui/**` because the vendored shadcn files export helpers next to components by design. Verified headlessly against the production build: a window marker survives Dashboard → Settings → Dashboard, and the outgoing page's translateX exit animation runs. `lib/moldRisk.ts` is still imported by the card and Dashboard, so it stays until the Conditions ticket (08) moves that logic server-side. The shadcn `ui/` set is kept whole per the spec, which leaves `ui/avatar`, `ui/collapsible`, `ui/dropdown-menu`, and `ui/breadcrumb` without a consumer for now.
- 2026-09-04 code review (standards + spec, two agents): no hard violations; ticket criteria met. Two disclosures. (1) The Dashboard countdown-seeding effect was rewritten to clear the `exhaustive-deps` warning; it now also runs when the device list changes without changing length (e.g. switching between two campuses with the same device count), seeding new cards at 30 and dropping stale ids instead of leaving them at 0 until their next reading. That is a small fix rather than "exactly as before". (2) The header brand link stays a raw `<a href="#">`; only the nav items moved to `Link`. Noted for later tickets: History's SSE handler matches on `d.name`, but the backend emits `{ type, device, data }`, so live refresh on History is a pre-existing no-op that ticket 09/10 should fix; and `30` is a hardcoded Report interval in Dashboard, which ticket 07 replaces with the API-reported value.
