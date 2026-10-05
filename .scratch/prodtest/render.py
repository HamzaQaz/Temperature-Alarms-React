"""Render status.json to status.html, the live production-test board shared as an Orca artifact."""
import datetime, html, json, pathlib

here = pathlib.Path(__file__).resolve().parent
s = json.loads((here / "status.json").read_text(encoding="utf-8"))
s["updated"] = datetime.datetime.now().strftime("%a %d %b, %H:%M")
(here / "status.json").write_text(json.dumps(s, indent=2), encoding="utf-8")
e = html.escape

STATE = {"running": "run", "done": "ok", "passed": "ok", "failed": "bad", "blocked": "bad"}
def state_class(state):
    return next((v for k, v in STATE.items() if state.startswith(k)), "wait")

agents = "".join(
    f'<tr><td><b>{e(a["name"])}</b><div class="dim">{e(a["what"])}</div></td>'
    f'<td><span class="pill {state_class(a["state"])}">{e(a["state"])}</span></td>'
    f'<td>{e(a["result"]) or "<span class=dim>Not reported yet</span>"}</td></tr>'
    for a in s["agents"])
SEV = {"blocker": "bad", "should-fix": "warn", "note": "wait", "fixed": "ok"}
findings = "".join(
    f'<tr><td><span class="pill {SEV.get(f["severity"], "wait")}">{e(f["severity"])}</span></td>'
    f'<td>{e(f["what"])}<div class="dim">{e(f.get("from", ""))}</div></td>'
    f'<td>{e(f.get("status", "open"))}</td></tr>'
    for f in s["findings"]) or '<tr><td colspan="3" class="dim">No findings reported yet.</td></tr>'
changes = "".join(
    f'<li><code>{e(c.get("commit", "pending"))}</code> {e(c["what"])}</li>'
    for c in s["changes"]) or '<li class="dim">No changes yet. Each fix appears here with its commit.</li>'
decisions = "".join(f"<li>{e(d)}</li>" for d in s["decisions"])

page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Production test board</title>
<style>
:root {{ color-scheme: dark; --bg: oklch(0.145 0 0); --panel: oklch(0.205 0 0); --line: oklch(1 0 0 / 10%);
  --text: oklch(0.985 0 0); --dim: oklch(0.708 0 0); --green: oklch(0.765 0.177 163.223);
  --amber: oklch(0.879 0.169 91.605); --red: oklch(0.808 0.114 19.571); --blue: oklch(0.828 0.111 230.318); }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--text); font: 400 15px/1.5 system-ui, sans-serif; }}
main {{ max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; display: grid; gap: 24px; }}
h1 {{ margin: 0; font-size: 1.875rem; letter-spacing: -0.02em; }}
h2 {{ margin: 0 0 8px; font-size: 1.125rem; }}
.dim {{ color: var(--dim); font-size: 0.875rem; }}
section {{ background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 20px; overflow-x: auto; }}
table {{ width: 100%; border-collapse: collapse; }}
td {{ padding: 10px 8px; border-top: 1px solid var(--line); vertical-align: top; }}
tr:first-child td {{ border-top: 0; }}
.pill {{ display: inline-block; padding: 2px 8px; border-radius: 8px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }}
.ok {{ background: oklch(0.696 0.17 162.48 / 18%); color: var(--green); }}
.run {{ background: oklch(0.685 0.169 237.323 / 18%); color: var(--blue); }}
.warn {{ background: oklch(0.769 0.188 70.08 / 20%); color: var(--amber); }}
.bad {{ background: oklch(0.637 0.237 25.331 / 22%); color: var(--red); }}
.wait {{ background: oklch(1 0 0 / 8%); color: var(--dim); }}
ul {{ margin: 0; padding-left: 20px; display: grid; gap: 6px; }}
code {{ font: 0.85rem ui-monospace, Consolas, monospace; color: var(--blue); }}
@media (max-width: 640px) {{ td {{ display: block; border-top: 0; padding: 4px 0; }} tr {{ display: block; border-top: 1px solid var(--line); padding: 8px 0; }} }}
</style></head><body><main>
<div><h1>Production test board</h1>
<p class="dim">{e(s["goal"])} Testing master <code>{e(s["master"])}</code>. Updated {e(s["updated"])}.</p></div>
<section><h2>Agents</h2><table>{agents}</table></section>
<section><h2>Findings</h2><table>{findings}</table></section>
<section><h2>Changes</h2><ul>{changes}</ul></section>
<section><h2>Decisions</h2><ul>{decisions}</ul></section>
</main></body></html>"""
(here / "status.html").write_text(page, encoding="utf-8")
print("rendered", s["updated"])
