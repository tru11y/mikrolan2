export const PORTAL_CSS = `
:root {
  color-scheme: dark light;
  --bg: #0f1419; --card: #182028; --line: #2a3541; --text: #e8edf2; --muted: #9db0c2;
  --accent: #4da3ff; --accent-text: #06121f; --ok: #3ecf8e; --warn: #f5b942; --bad: #ff6b6b;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f4f6f9; --card: #ffffff; --line: #d5dce4; --text: #14202b; --muted: #4a5b6c;
    --accent: #0b5cc2; --accent-text: #ffffff; --ok: #0a7a4b; --warn: #8a5a00; --bad: #b3261e;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.5rem; margin: 0; }
h2 { font-size: 1.1rem; margin: 0 0 12px; }
.top { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
.session { display: flex; align-items: center; gap: 12px; color: var(--muted); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
label { display: block; margin: 12px 0 4px; font-weight: 600; font-size: .9rem; }
label.inline { display: flex; gap: 8px; align-items: center; margin: 0; font-weight: 400; }
input, textarea { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--bg); color: var(--text); font: inherit; }
input[type=checkbox] { width: auto; }
input:focus-visible, textarea:focus-visible, .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 16px; }
.row.spread { justify-content: space-between; margin-top: 0; }
.btn { border: 1px solid var(--line); background: transparent; color: var(--text); padding: 8px 14px;
  border-radius: 8px; font: inherit; cursor: pointer; min-height: 40px; }
.btn.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }
.btn.danger { color: var(--bad); border-color: var(--bad); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.hint { color: var(--muted); font-size: .9rem; margin: 8px 0 0; }
.flash { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid var(--line); }
.flash.ok { border-color: var(--ok); color: var(--ok); }
.flash.err { border-color: var(--bad); color: var(--bad); }
progress { width: 100%; height: 16px; margin-top: 12px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .92rem; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); white-space: nowrap; vertical-align: middle; }
th { color: var(--muted); font-weight: 600; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .8rem; border: 1px solid; margin-right: 4px; }
.badge.ok { color: var(--ok); border-color: var(--ok); }
.badge.warn { color: var(--warn); border-color: var(--warn); }
.badge.mute { color: var(--muted); border-color: var(--muted); }
.actions { display: flex; gap: 6px; }
.notes { white-space: pre-wrap; color: var(--muted); margin: 8px 0 0; }
a { color: var(--accent); }
@media (max-width: 600px) { main { padding: 12px; } }
`;
