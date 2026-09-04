# 02 — Frontend dead code and dependency cleanup

**What to build:**
The frontend contains only code and packages it actually uses, and navigating between pages no longer reloads the browser. The app looks and behaves exactly as before.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Unused nav components, unused hooks, and unused helper modules are deleted
- [ ] Bootstrap and Font Awesome are removed from dependencies
- [ ] Only one of the two motion packages and one of the two number-flow packages remains, whichever is actually imported
- [ ] The `radix-ui` meta-package is removed in favour of the individual packages actually imported, or vice versa, but not both
- [ ] The sidebar navigates with router links, and the page transition animation visibly runs on navigation
- [ ] Lint and typecheck pass with zero warnings
- [ ] Dashboard, History, and Settings render and function as before
