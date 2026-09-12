# Desktop design review — September 2026

Hronaut is a persistent browser for people working alongside coding agents. The
window should make the current workspace, active page, and agent state easy to
recognize without competing with the website being inspected.

## Findings and decisions

| Surface | Finding | Implemented direction |
| --- | --- | --- |
| Whole window | Workspace names and tabs compete with a long row of global controls in the horizontal layout. | Default new profiles to the existing resizable left workspace rail. Preserve saved layout preferences and the top-tab option. |
| Navigation | Labeled global utilities occupy too much of the workspace rail. | Put Commands, Tabs, Downloads, History, input blocking, mute all tabs, and agent following on one icon row. Keep accessible names, tooltips, shortcuts, and state indicators. Place Settings after MCP status on the second row, with an optional update icon. Label the new-tab action within workspaces. |
| Tabs and title bar | Saturated shell surfaces and multiple nested borders give supporting UI excessive weight. | Neutral light/dark materials, softer workspace boundaries, clear active-tab accent, and matching native title-bar colors. |
| Page audio | Muting the current tab requires finding the tab-strip control or its context menu. | Add a native mute toggle beside the page input lock; reflect per-tab and global audio changes, including on silent tabs. |
| Address and overlays | Heavy shadows, large corner treatments, and a strongly obscured background interrupt orientation. | Smaller address-field radius, restrained focus treatment, lighter modal scrim, and consistent dialog materials. |
| Settings | Eleven sections with descriptions require sidebar scrolling before some destinations are visible. | A searchable, compact navigation list; descriptions remain available to search, assistive technology, and hover. Enter opens the first result; Escape clears a query before closing the dialog. All seven locales have search and empty-state copy. |
| Home | Returning users scroll through setup to find operational information. | Three dedicated views: Connect an agent, Overview, and Tool library. Remember the selected view; provide roving keyboard navigation. Keep setup, verification, and the first task together. Separate live metrics and clients from setup, and give the searchable catalog its own view. |
| Settings actions | Several actions reset native button styles and lose their shared appearance; others use inconsistent custom spacing. | Use the shared button and icon-button components for ordinary actions. Reserve custom styling for selection cards. Keep consistent primary, secondary, destructive, disabled, and keyboard focus states. |
| Small windows | Hidden utilities and added controls make compact rails harder to use. | Keep all seven utility icons visible down to the 200px rail minimum with at least 24px-wide, 32px-high targets. Preserve adaptive Settings navigation and verify all sections at narrow widths. |

The renderer continues to mirror main-process state. This redesign adds no new
privileged APIs, profile migrations, or browser automation permissions.

## Research

- [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh), March 2026: reduce the visual weight of navigation, distinguish headers by purpose, and use quieter borders. Applied to the browser shell, rail, title bar, and overlays.
- [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): keep primary tasks easy to find and reveal secondary detail when needed. Applied to settings navigation and Home's direct access to operational sections.

These are design principles, not evidence that this specific redesign improves
measured user performance. No user study has been conducted in this change.

## Verification

`tests/integration/desktop-design.e2e.ts` exercises the real application and
captures both tab layouts, native window composition, settings, workspace
creation, page tools, tab overview, and the command palette in light and dark.
It also verifies the fresh-profile default, named-icon hit testing, settings
search and recovery, Home view selection and search recovery, native per-tab mute
state, and WCAG A/AA checks on all three Home views in light and dark. Tool
descriptions expand on demand and retain focus through routine status polling.

`tests/integration/compact-utilities.e2e.ts` checks icon row geometry, hit targets,
MCP-to-Settings keyboard order, translated compact layouts, and Settings action
surfaces and focus. Both regression cases failed against 2.1.0 before the fixes.
The Settings layout gallery checks every section at 1200px, 760px, and 640px.

Existing Electron tests cover compact rails, resize/collapse, native input and
title-bar geometry, scaled settings, all theme-picker contrast checks, and Home
layout in English and Ukrainian. Unit coverage exercises settings search,
no-result recovery, Enter/Escape handling, and input-method composition.
The release uses the repository's immutable Docker integration gate and tagged
multi-platform packaging workflow.
