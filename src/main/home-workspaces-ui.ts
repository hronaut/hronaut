export const HOME_WORKSPACES_STYLES = `
.workspace-toolbar { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
.workspace-toolbar .search-field { flex: 1 1 260px; padding: 0; }
.workspace-toolbar input[type=search], .workspace-toolbar > button { height: 40px; }
.workspace-toolbar button, .home-workspace-card button, #workspace-undo { min-height: 38px; padding: 8px 13px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); font-size: 13px; font-weight: 600; }
.workspace-primary { background: var(--accent) !important; color: var(--button-text) !important; border-color: transparent !important; }
.workspace-collections { display: flex; gap: 6px; border-bottom: 1px solid var(--border); }
.workspace-collections button { padding: 12px 18px; border: 0; background: transparent; border-bottom: 2px solid transparent; color: var(--muted); font-weight: 600; }
.workspace-collections button[aria-selected=true] { color: var(--accent); border-bottom-color: var(--accent); }
#workspace-hint { color: var(--muted); font-size: 13px; margin: 16px 0; }
#workspace-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.home-workspace-card { min-width: 0; display: flex; flex-direction: column; padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); }
.home-workspace-card > header { display: flex; align-items: center; gap: 12px; min-width: 0; }
.home-workspace-card header > div { min-width: 0; }
.home-workspace-card h2 { margin: 0 0 5px; font-size: 17px; font-weight: 650; overflow-wrap: anywhere; }
.home-workspace-card header span:not(.workspace-symbol) { font-size: 12px; color: var(--muted); }
.workspace-symbol { flex: 0 0 42px; display: grid; place-items: center; height: 42px; font-size: 24px; color: var(--workspace-color); border-radius: 10px; background: color-mix(in srgb, var(--workspace-color) 12%, transparent); }
.home-workspace-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
.home-workspace-badges span { background: var(--soft); color: var(--muted); padding: 4px 7px; border-radius: 5px; font-size: 11px; }
.home-workspace-description { margin: 14px 0 0; white-space: pre-line; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.home-workspace-preview { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 14px 0 20px; }
.home-workspace-card footer { display: flex; gap: 8px; flex-wrap: wrap; margin-top: auto; }
.workspace-quick-settings { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }
.workspace-quick-settings summary { cursor: pointer; }
.workspace-quick-settings label { display: flex; align-items: center; gap: 8px; padding-top: 12px; cursor: pointer; }
.workspace-empty { grid-column: 1 / -1; padding: 50px 20px; text-align: center; color: var(--muted); border: 1px dashed var(--border); border-radius: 12px; }
.workspace-empty h2 { font-size: 20px; color: var(--text); }
#workspace-error { color: var(--danger); }
.workspace-feedback { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--accent-2); }
@media (max-width: 760px) { .workspace-toolbar .search-field { flex-basis: 100%; } .workspace-toolbar > button { flex: 1; } #workspace-grid { grid-template-columns: minmax(0, 1fr); } .home-workspace-card { padding: 16px; } }
`
