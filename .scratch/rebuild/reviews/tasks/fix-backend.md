Target: backend/ (src, test).

Change: fix findings 1, 2, 3, 4, 6, 7, and 8 in .scratch/rebuild/reviews/backend.md (your own review), test-first where a test can show the bug:
1. `trust proxy` = 1, plus a test where rotating X-Forwarded-For still hits 429.
2. A named MySQL lock (GET_LOCK) around runMigrations and migrateLegacy, so two runners cannot both copy legacy rows; a test that a second runner waits for the first or refuses.
3. 422 for temp outside -40..200 °F and humidity outside 0..100, added to the existing 422 test.
4. campusId above INT UNSIGNED is a 422 on POST and PATCH.
6. body-parser errors (413, 415, ...) keep their status instead of 500.
7. 0001 uses CREATE TABLE IF NOT EXISTS; 0004 guards its index the way introspect.ts does.
8. History query gets a row limit and a `truncated` flag; check what the frontend reads (frontend/src) and keep the response backward compatible (additive field only). Do not edit frontend/; if the frontend should show `truncated`, say so in your summary.
Leave finding 5 (DEPLOYMENT.md) alone; another worker owns that file.

Constraints: several Orca workers share this worktree; never commit, stash, reset, or checkout. Edit only backend/. Keep the code's existing style (comment density, naming). The DB on :3307 may already be up from another worker: use it if healthy and do not take it down then.

Ownership: backend/ only. Append a "Fixed" note per finding at the bottom of .scratch/rebuild/reviews/backend.md.

Observable acceptance: in backend/, `npm test` and `npm run typecheck` pass under PowerShell (npm runs cmd.exe on Windows), with the new tests among them. Send worker_done with --files-modified and test counts; --outcome succeeded only if all pass.
