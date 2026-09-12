import { CYBERPUNK_TURBO_COLORS } from '../shared/theme.js'

// Home is an isolated, trusted document rather than a renderer route. Its
// materials follow the desktop shell; the layout does not depend on shell CSS.
export const HOME_PAGE_STYLES = `
:root {
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --bg: #f7f7f8; --panel: #fff; --panel-solid: #fff; --text: #25262b;
  --muted: #62646d; --border: #e0e0e6; --soft: #f0f0f3;
  --danger: #b33343; --accent: #6250d8; --accent-2: #178354; --code: #202026; --code-text: #f2f2f6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #19191c; --panel: #222225; --panel-solid: #222225; --text: #ededf0;
    --muted: #b0b0ba; --border: #38383f; --soft: #2b2b30;
    --danger: #f28a96; --accent: #ad9aff; --accent-2: #42d392; --code: #161619; --code-text: #f2f2f6;
  }
}
:root[data-theme="cyberpunk-turbo"] {
  color-scheme: dark;
  --bg: ${CYBERPUNK_TURBO_COLORS.background}; --panel: #1a1a2e; --panel-solid: #1a1a2e;
  --text: ${CYBERPUNK_TURBO_COLORS.text}; --muted: ${CYBERPUNK_TURBO_COLORS.muted};
  --border: #594b70; --soft: #292942; --accent: ${CYBERPUNK_TURBO_COLORS.accent};
  --accent-2: ${CYBERPUNK_TURBO_COLORS.secondary}; --code: #12121e; --code-text: #d8e9f0;
}
* { box-sizing: border-box; }
html { min-width: 320px; min-height: 100%; background: var(--bg); scrollbar-color: var(--border) var(--bg); }
body { min-height: 100vh; margin: 0; color: var(--text); background: var(--bg); }
button, input { font: inherit; }
button { color: inherit; cursor: pointer; }
button:disabled { cursor: wait; opacity: .65; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
h1, h2, h3, p { margin: 0; }
h1 { font-size: clamp(23px, 2.5vw, 28px); font-weight: 650; line-height: 1.25; letter-spacing: -.035em; }
h2 { font-size: 15px; font-weight: 650; line-height: 1.4; letter-spacing: -.015em; }
.page { width: min(1240px, calc(100% - 64px)); margin: 0 auto; padding: 28px 0 20px; }
.hero { display: flex; justify-content: space-between; align-items: center; gap: 28px; }
.hero-copy { min-width: 0; }
.brand { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; color: var(--muted); font-size: 10px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
.mark { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 6px; color: var(--panel); background: var(--accent); font-size: 13px; letter-spacing: 0; }
.hero-description { max-width: 630px; margin-top: 8px; color: var(--muted); font-size: 13px; line-height: 1.6; }
.hero-status { display: grid; flex: 0 0 auto; grid-template-columns: auto auto; align-items: center; gap: 8px 14px; max-width: 285px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); }
.status-label { display: flex; grid-column: 1 / -1; align-items: center; gap: 8px; color: var(--muted); font-size: 11px; font-weight: 550; }
.status-value { font-size: 17px; font-weight: 650; letter-spacing: -.02em; }
.status-detail { max-width: 165px; color: var(--muted); font-size: 11px; line-height: 1.4; text-align: right; }
.dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--accent-2); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-2) 12%, transparent); }
.dot.starting { background: #4f8cff; }
.dot.paused { background: #cf8b26; }
.dot.error { background: #df4b5f; }
.home-navigation { display: flex; align-items: stretch; gap: 22px; overflow-x: auto; overflow-y: hidden; margin: 20px 0 24px; border-bottom: 1px solid var(--border); scrollbar-width: thin; }
.home-navigation button { position: relative; min-height: 44px; padding: 10px 2px; border: 0; color: var(--muted); background: transparent; font-size: 13px; font-weight: 550; }
.home-navigation button:hover { color: var(--text); }
.home-navigation button:focus-visible { outline-offset: -3px; }
.home-navigation button[aria-selected="true"] { color: var(--accent); }
.home-navigation button[aria-selected="true"]::after { position: absolute; right: 0; bottom: 0; left: 0; height: 2px; background: var(--accent); content: ''; }
.home-view { min-width: 0; }
.home-view:focus { outline-offset: 6px; }
.connect-layout { display: grid; grid-template-columns: minmax(0, 1fr) 272px; align-items: start; gap: 24px; }
.panel { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); }
.panel-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.panel-heading p { margin-top: 5px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.count { flex: 0 0 auto; padding: 4px 7px; border-radius: 5px; color: var(--muted); background: var(--soft); font-size: 10px; line-height: 1.3; }
.agent-layout { display: grid; grid-template-columns: 184px minmax(0, 1fr); }
.guide-picker { min-width: 0; padding-bottom: 10px; border-right: 1px solid var(--border); background: color-mix(in srgb, var(--soft) 42%, var(--panel)); }
.search-field { display: block; padding: 16px 12px 10px; }
.search-field > span { display: block; margin-bottom: 7px; color: var(--muted); font-size: 11px; }
input[type=search] { width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid var(--border); border-radius: 7px; color: var(--text); background: var(--panel); font-size: 13px; }
input[type=search]:focus-visible { outline-width: 2px; outline-offset: 1px; }
.agents { max-height: 290px; padding: 0 8px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.agent-button { display: flex; align-items: center; width: 100%; min-height: 35px; margin: 2px 0; padding: 8px 10px; border: 1px solid transparent; border-radius: 6px; background: transparent; text-align: left; font-size: 12px; font-weight: 500; }
.agent-button:hover { background: var(--soft); }
.agent-button.active { border-color: color-mix(in srgb, var(--accent) 22%, var(--border)); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--panel)); font-weight: 650; }
.guide { min-width: 0; padding: 24px; }
.guide-kicker, .section-kicker, .first-run-kicker { display: block; color: var(--muted); font-size: 10px; font-weight: 600; line-height: 1.5; letter-spacing: .07em; text-transform: uppercase; }
.guide h3 { margin: 6px 0 0; font-size: 26px; font-weight: 600; letter-spacing: -.035em; }
.guide-note { margin: 8px 0 20px; color: var(--muted); font-size: 13px; line-height: 1.6; }
.location { margin-bottom: 8px; overflow-wrap: anywhere; color: var(--muted); font: 11px/1.5 "SFMono-Regular", Consolas, monospace; }
.code-wrap { position: relative; min-width: 0; }
pre { min-height: 88px; margin: 0; padding: 16px 74px 16px 16px; overflow: auto; border-radius: 8px; color: var(--code-text); background: var(--code); font: 12px/1.7 "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.copy-button { flex: 0 0 auto; min-height: 32px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); font-size: 11px; font-weight: 600; }
.copy-button:hover { border-color: var(--accent); color: var(--accent); }
.code-copy { position: absolute; top: 10px; right: 10px; border-color: #53535b; color: var(--code-text); background: #323238; }
.code-copy:hover { color: white; border-color: #94949d; }
.verify { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.verify-label { color: var(--muted); font-size: 11px; font-weight: 600; }
.verify code { min-width: 0; flex: 1; padding: 9px 10px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--soft); font: 11px "SFMono-Regular", Consolas, monospace; }
.guide-doc-action, .guide-primary-action { margin-top: 16px; }
.guide-doc-action button, .text-action { padding: 0; border: 0; color: var(--accent); background: transparent; font-size: 12px; font-weight: 600; line-height: 1.6; text-align: left; }
.guide-doc-action button:hover, .text-action:hover { text-decoration: underline; text-underline-offset: 4px; }
.guide-primary-action button { padding: 9px 12px; border: 1px solid var(--accent); border-radius: 7px; color: var(--text); background: color-mix(in srgb, var(--accent) 12%, var(--panel)); font-size: 12px; font-weight: 650; }
.guide-primary-status, .security { display: block; margin-top: 16px; color: var(--muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.security { padding-top: 14px; border-top: 1px solid var(--border); }
.connect-aside { min-width: 0; }
.connection-check { padding: 4px 0 22px; }
.connection-check h2 { margin-top: 8px; }
.connection-check .text-action { display: inline-block; margin-top: 10px; }
.connection-note { margin: 9px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.first-run { padding: 20px; background: var(--panel); }
.first-run h2 { margin-top: 8px; font-size: 16px; }
.first-run p { margin-top: 9px; color: var(--muted); font-size: 12px; line-height: 1.6; }
.first-run .code-wrap { margin-top: 16px; }
.first-run pre { min-height: 0; padding: 12px; font-size: 11px; line-height: 1.65; }
.first-run .code-copy { position: static; width: 100%; margin-top: 10px; border-color: var(--border); color: var(--text); background: var(--soft); }
.first-run .code-copy:hover { border-color: var(--accent); }
.impact-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px; }
.impact { padding: 22px 24px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); }
.impact strong { display: block; font-size: 32px; font-weight: 600; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.impact span { display: block; margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.overview-layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr); align-items: start; gap: 24px; }
.activity-layout { padding: 18px 20px; }
.activity-column h3 { margin-bottom: 10px; color: var(--muted); font-size: 11px; font-weight: 600; }
.activity-list { min-height: 140px; }
.activity-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.activity-item:last-child { border-bottom: 0; }
.activity-item code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px "SFMono-Regular", Consolas, monospace; }
.activity-meta { margin-top: 5px; color: var(--muted); font-size: 11px; }
.outcome { padding: 4px 7px; border-radius: 5px; color: var(--accent-2); background: color-mix(in srgb, var(--accent-2) 9%, var(--panel)); font-size: 11px; font-weight: 600; }
.outcome.failed { color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, var(--panel)); }
.outcome.attention { color: var(--text); background: color-mix(in srgb, #d69b36 14%, var(--panel)); }
.privacy-note { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; line-height: 1.6; }
.connections-body { max-height: 400px; padding: 4px 18px; overflow-y: auto; scrollbar-width: thin; }
.empty { display: grid; min-height: 146px; align-content: center; padding: 22px 4px; }
.empty strong { display: block; font-size: 14px; font-weight: 600; }
.empty span { display: block; max-width: 420px; margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.7; }
.connection { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.connection:last-child { border-bottom: 0; }
.client-icon { display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid var(--border); border-radius: 7px; color: var(--accent); background: var(--soft); font-size: 12px; font-weight: 650; }
.client-name { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.client-meta { margin-top: 4px; color: var(--muted); font-size: 10px; line-height: 1.5; }
.connection-state { color: var(--muted); font-size: 10px; }
.connection-state.active { color: var(--accent-2); }
.tools > .connection-note { padding: 12px 20px 0; }
.tools .search-field { padding: 16px 20px; }
.tools .search-field > span { font-size: 12px; }
.tools input { padding: 12px; }
.tool-grid { max-height: min(65vh, 640px); overflow-y: auto; scrollbar-width: thin; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; gap: 1px; padding: 0 20px 20px; }
.tool { min-width: 0; padding: 18px; border-bottom: 1px solid var(--border); }
.tool summary { cursor: pointer; }
.tool summary::marker { color: var(--muted); font-size: 10px; }
.tool-top { display: inline-flex; width: calc(100% - 18px); flex-direction: column-reverse; align-items: start; gap: 9px; vertical-align: middle; }
.tool code { max-width: 100%; overflow-wrap: anywhere; font: 12px "SFMono-Regular", Consolas, monospace; }
.category { color: var(--accent); font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.tool p { margin-top: 10px; color: var(--muted); font-size: 12px; line-height: 1.6; }
.filter-empty { padding: 12px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.home-bottom { margin-top: 24px; }
.endpoint { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--border); }
.endpoint-label { color: var(--muted); font-size: 10px; font-weight: 550; text-transform: uppercase; letter-spacing: .04em; }
.endpoint code { min-width: 0; flex: 1; overflow: hidden; color: var(--muted); font: 11px "SFMono-Regular", Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
.support-panel { border-top: 1px solid var(--border); }
.support-panel > summary { width: fit-content; min-height: 36px; padding: 10px 0; color: var(--muted); cursor: pointer; font-size: 12px; }
.support-card { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 12px 0 20px; }
.support-card > span, .support-card > h3, .support-card > p, .support-card > small, .support-card > .action-status { grid-column: 1 / -1; }
.support-card > span { color: var(--muted); font-size: 11px; }
.support-card h3 { font-size: 16px; font-weight: 600; }
.support-card p, .support-card small { max-width: 720px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.support-card button { min-height: 36px; padding: 9px 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel); font-size: 12px; text-align: left; }
.support-card button:hover { border-color: var(--accent); }
.action-status { display: block; margin-top: 8px; color: var(--text); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.action-status:empty { display: none; }
.footer { display: flex; justify-content: space-between; gap: 18px; padding-top: 14px; border-top: 1px solid var(--border); color: var(--muted); font-size: 10px; line-height: 1.6; }
:root[data-theme="cyberpunk-turbo"] :is(.panel, .hero-status, .impact, input, button, pre) { border-radius: 4px; }
:root[data-theme="cyberpunk-turbo"] h1 { color: var(--accent-2); }
:root[data-theme="cyberpunk-turbo"] .mark { background: ${CYBERPUNK_TURBO_COLORS.highlight}; }
@media (max-width: 1050px) {
  .page { width: calc(100% - 40px); padding-top: 22px; }
  .connect-layout { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .connect-aside { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 24px; }
  .connection-check { padding: 14px 0; }
  .hero { gap: 20px; }
  .hero-status { max-width: 250px; padding: 12px; }
  .tool-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .page { width: calc(100% - 28px); padding-top: 18px; }
  .hero { flex-direction: column; align-items: stretch; gap: 14px; }
  .brand { margin-bottom: 10px; }
  .hero-status { display: flex; max-width: none; gap: 12px; padding: 10px 12px; flex-wrap: wrap; }
  .status-label { flex: 1; }
  .status-detail { max-width: none; }
  .home-navigation { gap: 18px; margin-top: 12px; }
  .home-navigation button { font-size: 12px; }
  .agent-layout { grid-template-columns: 142px minmax(0, 1fr); }
  .guide { padding: 18px; }
  .guide h3 { font-size: 23px; }
  .verify-label { flex-basis: 100%; }
  .connect-aside, .overview-layout { grid-template-columns: 1fr; }
  .impact-grid { gap: 8px; }
  .impact { padding: 14px; }
  .impact strong { font-size: 26px; }
  .impact span { font-size: 11px; }
  .tool-grid { grid-template-columns: 1fr; padding: 0 4px 12px; }
  .endpoint { flex-wrap: wrap; gap: 8px; }
  .endpoint-label { flex-basis: 100%; }
  .support-card { grid-template-columns: 1fr; }
}
@media (max-width: 420px) {
  .agent-layout { grid-template-columns: 1fr; }
  .guide-picker { border-right: 0; border-bottom: 1px solid var(--border); }
  .agents { display: flex; max-height: 105px; overflow: auto; }
  .agent-button { flex: 0 0 auto; width: auto; }
  .impact-grid { grid-template-columns: 1fr; }
}
`
