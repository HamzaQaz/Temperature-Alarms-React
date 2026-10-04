Target: arduino/ (TemperatureAlarms sketch, bench.py, test_bench.py) and CONTEXT.md.

Change: fix findings 4, 5, 6, 12, and 17 in .scratch/rebuild/reviews/firmware-docs.md (your own review):
- 4: the bench watcher's stop summary must list boards the sheet lacked at start even after write-back appended them; add a test at the reconcile/Inventory seam first.
- 5: the millis() stall after ~24.8 days: use the wrap-safe `millis() - last >= interval` form everywhere timing is compared, and make sure a never-sent state cannot wait a full wrap.
- 6: make the WiFi drop handling match the module's comments (no immediate WiFi.begin() storm; back off as the comments say), or, if the comments are what is wrong, fix the comments. Keep the open-network path from commit 3d67145.
- 12: the --inventory help text says the sheet is written back.
- 17: CONTEXT.md's Bench definition matches what the watcher does.

Constraints: several Orca workers share this worktree; never commit, stash, reset, or checkout. Edit only the files listed under Ownership. The firmware must still compile: if arduino-cli is installed, compile for esp8266:esp8266:nodemcuv2 (install the core only if that is quick); if it is not, say so and re-read the diff carefully instead. No hardware is attached.

Ownership: arduino/ and CONTEXT.md. Append a "Fixed" note per finding at the bottom of .scratch/rebuild/reviews/firmware-docs.md. Leave the other findings (docs, containers, .gitignore) alone; other workers own those files.

Observable acceptance: `python -m unittest arduino/test_bench.py` passes, including the new test, 5 runs in a row; the compile result or a clear "not compiled, arduino-cli absent". Send worker_done with --files-modified; --outcome succeeded only if the tests pass.
