// This script runs only inside the trusted Home document. Workspace operations
// cross its narrow preload bridge and remain authoritative in the main process.
export const HOME_WORKSPACES_SCRIPT = String.raw`
    let workspaceState = initialWorkspaces;
    let workspaceView = 'open';
    let workspacePending = false;
    let workspaceRevision = 0;
    let renderedWorkspaces = '';
    let undoWorkspaceId = null;
    const workspaceRoot = document.getElementById('home-workspaces');
    const workspaceSearch = document.getElementById('workspace-search');
    const workspaceGrid = document.getElementById('workspace-grid');
    const workspaceError = document.getElementById('workspace-error');
    const workspaceNotice = document.getElementById('workspace-notice');
    const workspaceUndo = document.getElementById('workspace-undo');
    function workspaceCount(message, count) {
      const forms = message.split(' | ');
      const category = new Intl.PluralRules(locale).select(count);
      const index = forms.length === 2 ? (count === 1 ? 0 : 1) : category === 'one' ? 0 : category === 'few' ? 1 : forms.length - 1;
      return interpolate(forms[index] || forms[0], { count: new Intl.NumberFormat(locale).format(count) });
    }
    function workspaceButton(action, label, id, disabled = false, primary = false) {
      return '<button type="button" data-workspace-action="' + action + '" data-workspace-id="' + escapeText(id) + '"' + (disabled || workspacePending ? ' disabled' : '') + (primary ? ' class="workspace-primary"' : '') + '>' + escapeText(label) + '</button>';
    }
    function renderWorkspaces() {
      const groups = [
        ...workspaceState.mcpTabGroups.map(group => ({ ...group, archived: false, timestamp: group.lastUsedAt, tabs: workspaceState.tabs.filter(tab => tab.mcpGroupId === group.id) })),
        ...workspaceState.savedTabGroups.map(group => ({ ...group, archived: true, timestamp: group.savedAt }))
      ].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.name.localeCompare(b.name));
      const query = workspaceSearch.value.trim().toLocaleLowerCase(locale);
      const visible = groups.filter(group => group.archived === (workspaceView === 'archived'))
        .filter(group => (group.name + ' ' + group.tabs.map(tab => tab.title + ' ' + tab.url).join(' ')).toLocaleLowerCase(locale).includes(query));
      for (const view of ['open', 'archived']) {
        const button = document.getElementById('workspaces-' + view);
        button.textContent = workspaceMessages[view] + ' (' + groups.filter(group => group.archived === (view === 'archived')).length + ')';
        button.setAttribute('aria-selected', String(view === workspaceView));
        button.tabIndex = view === workspaceView ? 0 : -1;
      }
      workspaceGrid.setAttribute('aria-labelledby', 'workspaces-' + workspaceView);
      document.getElementById('workspace-hint').textContent = workspaceMessages[workspaceView === 'archived' ? 'archiveHelp' : 'openHelp'];
      workspaceUndo.hidden = !undoWorkspaceId || !workspaceState.savedTabGroups.some(group => group.id === undoWorkspaceId);
      const html = visible.length ? visible.map(group => {
        const badges = [workspaceMessages[group.agentAccess === false ? 'personal' : 'agentAccess']];
        if (group.hiddenFromSidebar) badges.push(workspaceMessages.hidden);
        if (group.deletionProtected) badges.push(workspaceMessages.protected);
        if (group.navigationPolicy.mode === 'restricted') badges.push(workspaceMessages.restricted);
        return '<article class="home-workspace-card" aria-label="' + escapeText(group.name) + '"><header><span class="workspace-symbol" style="--workspace-color:' + workspaceColors[group.color] + '" aria-hidden="true">' + (group.archived ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8v12h16V8M3 4h18v4H3zM9 12h6"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7V5h7l2 3h9v12H3V7z"/></svg>') + '</span><div><h2>' + escapeText(group.name) + '</h2><span>' + escapeText(workspaceCount(workspaceLabels.tabs, group.tabs.length)) + ' · ' + escapeText(workspaceCount(workspaceLabels.sites, group.storageOriginCount || 0)) + '</span></div></header><div class="home-workspace-badges">' + badges.map(label => '<span>' + escapeText(label) + '</span>').join('') + '</div><p class="home-workspace-preview">' + escapeText(group.tabs.slice(0, 2).map(tab => tab.title || tab.url).join(' · ') || workspaceMessages.noTabs) + '</p><footer>'
          + workspaceButton('open', group.archived ? workspaceMessages.restore : workspaceMessages.openWorkspace, group.id, false, true)
          + workspaceButton(group.archived ? 'transfer' : 'edit', group.archived ? workspaceLabels.transfer : workspaceLabels.manage, group.id)
          + workspaceButton(group.archived ? 'delete' : 'archive', group.archived ? workspaceMessages.delete : workspaceMessages.archive, group.id, workspaceState.allHumanInteractionLocked || (group.archived && group.deletionProtected))
          + (group.archived ? '' : workspaceButton('clear', workspaceMessages.clear, group.id, group.deletionProtected))
          + '</footer><details class="workspace-quick-settings"><summary>' + escapeText(workspaceMessages.preferences) + '</summary><label><input type="checkbox" data-workspace-preference="hiddenFromSidebar" data-workspace-id="' + escapeText(group.id) + '"' + (group.hiddenFromSidebar ? ' checked' : '') + (workspacePending ? ' disabled' : '') + '>' + escapeText(workspaceMessages.hideFromSidebar) + '</label><label><input type="checkbox" data-workspace-preference="deletionProtected" data-workspace-id="' + escapeText(group.id) + '"' + (group.deletionProtected ? ' checked' : '') + (workspacePending ? ' disabled' : '') + '>' + escapeText(workspaceMessages.protectDeletion) + '</label></details></article>';
      }).join('') : '<div class="workspace-empty"><h2>' + escapeText(workspaceMessages[query ? 'noMatches' : workspaceView === 'archived' ? 'noArchived' : 'empty']) + '</h2><p>' + escapeText(workspaceMessages[query ? 'searchHelp' : workspaceView === 'archived' ? 'archiveHelp' : 'emptyHelp']) + '</p></div>';
      // Preserve focused controls and expanded preferences during status polling.
      if (html === renderedWorkspaces) return;
      renderedWorkspaces = html;
      const expanded = new Set(Array.from(workspaceGrid.querySelectorAll('details[open]')).map(details => details.querySelector('input').dataset.workspaceId));
      const focused = document.activeElement;
      const focusId = focused?.dataset.workspaceId;
      const focusKey = focused?.dataset.workspaceAction || focused?.dataset.workspacePreference;
      workspaceGrid.innerHTML = html;
      workspaceGrid.querySelectorAll('details').forEach(details => { details.open = expanded.has(details.querySelector('input').dataset.workspaceId); });
      if (focusId && focusKey) Array.from(workspaceGrid.querySelectorAll('button,input')).find(node => node.dataset.workspaceId === focusId && (node.dataset.workspaceAction || node.dataset.workspacePreference) === focusKey)?.focus();
    }
    async function workspaceAction(request) {
      if (workspacePending) return;
      if (request.view === 'delete' || request.view === 'clear') {
        const group = request.view === 'delete'
          ? workspaceState.savedTabGroups.find(group => group.id === request.workspaceId)
          : workspaceState.mcpTabGroups.find(group => group.id === request.workspaceId);
        if (!group || group.deletionProtected || !window.confirm(interpolate(workspaceMessages[request.view === 'clear' ? 'clearConfirm' : 'deleteConfirm'], { name: group.name }))) return;
      }
      workspacePending = true;
      const revision = ++workspaceRevision;
      workspaceError.textContent = '';
      workspaceError.hidden = true;
      workspaceRoot.setAttribute('aria-busy', 'true');
      workspaceRoot.querySelectorAll('[data-workspace-action]').forEach(button => { button.disabled = true; });
      renderWorkspaces();
      try {
        const group = [...workspaceState.mcpTabGroups, ...workspaceState.savedTabGroups].find(group => group.id === request.workspaceId);
        const next = await window.hronautHome.workspaceAction(request);
        if (revision !== workspaceRevision) return;
        workspaceState = next;
        if (request.view === 'archive') {
          undoWorkspaceId = request.workspaceId;
          workspaceNotice.textContent = interpolate(workspaceMessages.archiveNotice, { name: group.name });
        } else if (request.view === 'restore' || request.view === 'delete' || request.view === 'clear') {
          undoWorkspaceId = null;
          workspaceNotice.textContent = interpolate(workspaceMessages[request.view === 'restore' ? 'restoreNotice' : request.view === 'clear' ? 'clearNotice' : 'deleteNotice'], { name: group.name });
        }
      } catch (cause) {
        if (revision === workspaceRevision) {
          workspaceError.textContent = cause instanceof Error ? cause.message : workspaceMessages.actionError;
          workspaceError.hidden = false;
        }
      } finally {
        if (revision === workspaceRevision) {
          workspacePending = false;
          workspaceRoot.setAttribute('aria-busy', 'false');
          workspaceRoot.querySelectorAll('[data-workspace-action]').forEach(button => { button.disabled = false; });
          renderedWorkspaces = '';
          renderWorkspaces();
        }
      }
    }
    async function refreshWorkspaces() {
      if (workspacePending || !window.hronautHome?.getWorkspaces) return;
      const revision = ++workspaceRevision;
      try {
        const next = await window.hronautHome.getWorkspaces();
        if (revision !== workspaceRevision) return;
        workspaceState = next;
        renderWorkspaces();
      } catch { /* Keep the last state; actions report their own errors. */ }
    }
    workspaceRoot.addEventListener('click', event => {
      const button = event.target.closest('[data-workspace-action]');
      if (button && !button.disabled) void workspaceAction({ view: button.dataset.workspaceAction, workspaceId: button.dataset.workspaceId });
    });
    workspaceRoot.addEventListener('change', event => {
      const input = event.target.closest('[data-workspace-preference]');
      if (input) void workspaceAction({ view: 'preferences', workspaceId: input.dataset.workspaceId, [input.dataset.workspacePreference]: input.checked });
    });
    workspaceSearch.addEventListener('input', renderWorkspaces);
    workspaceUndo.addEventListener('click', () => workspaceAction({ view: 'restore', workspaceId: undoWorkspaceId }));
    for (const view of ['open', 'archived']) {
      const button = document.getElementById('workspaces-' + view);
      button.addEventListener('click', () => { workspaceView = view; renderWorkspaces(); });
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        workspaceView = event.key === 'Home' ? 'open' : event.key === 'End' ? 'archived' : workspaceView === 'open' ? 'archived' : 'open';
        renderWorkspaces();
        document.getElementById('workspaces-' + workspaceView).focus();
      });
    }
    renderWorkspaces();
`;

export const HOME_WORKSPACES_STYLES = `
.workspace-toolbar { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
.workspace-toolbar .search-field { flex: 1 1 260px; padding: 0; }
.workspace-toolbar input[type=search], .workspace-toolbar > button { height: 40px; }
.workspace-toolbar button, .home-workspace-card button, #workspace-undo { min-height: 38px; padding: 8px 13px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); font-size: 13px; font-weight: 600; }
.workspace-primary { background: var(--accent) !important; color: var(--bg) !important; border-color: transparent !important; }
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
.workspace-symbol svg { width: 24px; height: 24px; }
.workspace-symbol { flex: 0 0 42px; display: grid; place-items: center; height: 42px; font-size: 32px; color: var(--workspace-color); border-radius: 10px; background: color-mix(in srgb, var(--workspace-color) 12%, transparent); }
.home-workspace-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
.home-workspace-badges span { background: var(--soft); color: var(--muted); padding: 4px 7px; border-radius: 5px; font-size: 11px; }
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
`;
