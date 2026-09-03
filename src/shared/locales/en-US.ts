export const enUS = {
  common: {
    hronaut: 'Hronaut',
    close: 'Close',
    system: 'System',
    english: 'English',
    ukrainian: 'Українська',
    tryAgain: 'Try again',
    checkAgain: 'Check again'
  },
  appearance: {
    heading: 'Application theme',
    description: "Choose how Hronaut's tabs, toolbar, dialogs, and menus look.",
    themeGroup: 'Theme',
    themeCategories: { regular: 'Everyday', expressive: 'Cinematic' },
    themes: {
      system: { label: 'System', description: 'Follow your device' },
      light: { label: 'Light', description: 'Bright and clear' },
      dark: { label: 'Dark', description: 'Easy on the eyes' },
      midnight: { label: 'Midnight', description: 'Deep blue focus' },
      sepia: { label: 'Sepia', description: 'Warm paper calm' },
      cyberpunk: { label: 'Cyberpunk', description: 'Neon violet' },
      matrix: { label: 'Matrix', description: 'Green terminal rain' },
      machine: { label: 'Machine', description: 'Red tactical HUD' },
      galactic: { label: 'Galactic', description: 'Deep-space command' }
    },
    systemThemeHelp: 'System follows your device as it changes. A specific theme stays fixed for this Hronaut profile.',
    language: {
      label: 'Interface language',
      description: 'Use your device language or choose a language for this Hronaut profile.',
      systemOption: 'System default — {language}',
      changeFailed: 'The language preference could not be saved. Your previous language is still active.'
    },
    interfaceSize: {
      label: 'Interface size',
      description: "Enlarge Hronaut's controls and text without changing website zoom.",
      compact: 'Compact', compactDescription: '100% · more room',
      comfortable: 'Comfortable', comfortableDescription: '110% · balanced',
      large: 'Large', largeDescription: '125% · easier to read'
    },
    tabPosition: {
      label: 'Tab position',
      description: 'Keep tabs across the top or show full titles in a scrollable left rail.',
      top: 'Top',
      left: 'Left side'
    },
    systemTitleBar: {
      label: 'Use system title bar',
      description: 'Restore the operating system title bar if the compact window controls do not work correctly.',
      restartRequired: 'Restart Hronaut to apply this window-frame change.'
    },
    hideInTray: {
      label: 'Hide in tray when closing',
      description: 'Keep Hronaut and its MCP server running after the window is closed.'
    },
    playAttentionSound: {
      label: 'Play attention sound',
      description: 'Play a warning cue when an agent needs you to complete a manual browser step.'
    },
    attentionSound: {
      label: 'Attention sound',
      description: 'Choose the cue that plays when Hronaut needs you.',
      test: 'Test sound',
      cues: {
        warning: 'Warning', bell: 'Bell', chime: 'Chime', ping: 'Ping', bubble: 'Bubble', pop: 'Pop',
        ready: 'Ready', complete: 'Complete', sparkle: 'Sparkle', success: 'Success', error: 'Error'
      }
    }
  },
  settings: {
    kicker: 'Hronaut preferences', heading: 'Settings', close: 'Close settings', sections: 'Settings sections', reset: 'Reset to default',
    nav: {
      appearance: 'Appearance', appearanceDescription: 'Theme and window', search: 'Search engine', searchDescription: 'Address bar searches', downloads: 'Downloads', downloadsDescription: 'Location and prompts', performance: 'Performance', performanceDescription: 'Sleeping tabs', mcp: 'MCP security', mcpDescription: 'Local authentication', privacy: 'Privacy & data', privacyDescription: 'History, cookies, cache', permissions: 'Site permissions', permissionsDescription: 'Per-website access', passwords: 'Passwords', passwordsDescription: 'Saved accounts', wallets: 'Wallets', walletsDescription: 'Web3 accounts and policies', updates: 'Updates', updatesDescription: 'Automatic checks', support: 'Commercial license', supportDescription: 'Activation and subscription'
    },
    search: { heading: 'Default search engine', description: 'Choose where plain text entered in the address bar or through browser_navigate is searched.', privacy: 'Local tabs, bookmarks, and history suggestions stay on this device. Hronaut sends the query only after you submit it.' },
    downloads: { heading: 'Website downloads', description: 'Choose where new files go and whether Hronaut asks before saving each one.', location: 'Download location', change: 'Change…', open: 'Open folder', ask: 'Ask where to save each file', askDescription: 'Show the operating system save dialog for every new website download.', help: 'Changes apply to new website downloads. Active transfers keep their original destination. PDF exports and agent-created files use the selected folder without opening a human dialog.' },
    memory: { heading: 'Memory Saver', description: 'Unload inactive website tabs so active human and agent work gets more CPU and memory.', sleeping: 'sleeping', of: 'of', websiteTabs: 'website tabs', auto: 'Automatically sleep inactive tabs', autoDescription: 'Sleeping tabs wake before you select them or an MCP tool uses them.', sleepAfter: 'Sleep after', counted: "Counted from the tab's last selection, human input, navigation, or MCP command.", sleepNow: 'Sleep eligible tabs now', help: 'Visible, pinned, loading, audio-playing, downloading, form-edited, DevTools, and active MCP tabs stay awake. Sleeping unloads the page and restores its navigation history when it wakes.' },
    mcp: { heading: 'MCP security', description: 'Control which local applications can connect to this browser profile.', require: 'Require MCP authentication', requireDescription: 'Require the owner-only per-profile bearer token for MCP and health requests.', toolSet: 'MCP tool set', toolSetDescription: 'Choose the task-focused catalog advertised to every connected coding agent.', toolSetEssentials: 'Browser Essentials', toolSetQa: 'Web QA', toolSetComplete: 'Complete', toolSetReconnect: 'Reconnect MCP clients that cache the tool catalog after changing this setting.', port: 'MCP server port', portDescription: 'Move the local listener without restarting Hronaut. Connected clients must use the new endpoint.', moving: 'Moving…', applyPort: 'Apply port', tokenHelp: 'The token is generated once per profile and never displayed on Hronaut Home.', warning: 'Authentication is off. Any process on this computer can control logged-in tabs and attach local files.' },
    permissions: { heading: 'Site permissions', description: 'Review access decisions remembered for each website.', emptyHeading: 'No saved decisions', emptyDescription: 'Websites will appear here after they request permission and you choose Allow or Deny.', allow: 'Allow', block: 'Block', forget: 'Forget decision', help: 'Removing a decision makes Hronaut ask again the next time the website requests that permission.' },
    passwords: { heading: 'Saved passwords', description: 'Save website logins with explicit consent and fill them from the password button in the toolbar.', importHeading: 'Import from another browser', importDescription: 'Export passwords as CSV from Chrome, Edge, Firefox, or another password manager, then choose that file.', importButton: 'Choose browser CSV…', importing: 'Importing…', imported: 'Imported {added} new and updated {updated}; skipped {skipped}.', importPlaintext: 'Browser CSV exports contain readable passwords. Hronaut reads the selected file only in the main process, encrypts accepted accounts immediately, and never exposes passwords to MCP. Delete the CSV after import.', emptyHeading: 'No saved passwords', emptyDescription: 'After you submit a password form yourself, Hronaut will ask whether to save it.', remove: 'Remove saved password', removeAria: 'Remove saved password for {username} on {origin}', unnamed: 'unnamed account', encryptedBy: 'Encrypted by', help: 'Filling a password automatically pauses new MCP commands and leaves agents paused until you resume them.' },
    updates: { heading: 'Software updates', description: 'Keep Hronaut current without downloading or installing anything silently.', startup: 'Check for updates on startup', startupDescription: 'Run a background check shortly after Hronaut opens.', current: 'Current version', check: 'Check now', help: 'Hronaut asks before downloading and installing an available update.' },
    privacy: { heading: 'Privacy & browsing data', description: 'Manage the durable Default workspace profile. Isolated workspaces are managed from their workspace editor.', whatToClear: 'What to clear', history: 'History', localVisits: 'Local visits', cookies: 'Cookies & site data', signOut: 'May sign you out', cache: 'Cached files', slower: 'Reloads may be slower', clearingAll: 'Clearing all…', clearAll: 'Clear all websites… ({count})', totals: '{history} history page | {history} history pages', totalsDetail: '{history} · {cookies} · {cache} cache', loadingTotals: 'Loading profile totals…', websites: 'Websites', websitesDescription: 'Search Default and application-wide records, then clear the selected categories from one website.', refresh: 'Refresh', search: 'Search websites', range: '{shown} of {total}', finding: 'Finding websites…', checking: 'Checking the Default workspace and application-wide records.', empty: 'No websites yet', emptyDescription: 'Websites appear after they are visited, opened, bookmarked, granted a permission, saved with an account, or store a cookie.', noMatches: 'No matching websites', noMatchesDescription: 'Try a hostname, title, or full origin.', known: 'Known to Default', clearSiteAria: 'Clear selected data for {origin}', clearing: 'Clearing…', clear: 'Clear…', exclusions: 'Bookmarks ({bookmarks}), saved passwords ({passwords}), site-permission decisions ({permissions}), downloaded files, settings, and open tabs stay untouched. Open pages are not reloaded automatically. New MCP commands pause only while clearing is in progress. Cookies, cache, and site data here belong to Default; history, bookmarks, saved accounts, and downloaded files are application-wide. The website list combines origins known from those records and open Default tabs. Chromium does not expose a complete index of storage-only origins. Related subdomains may share cookies.' },
    support: { kicker: 'Commercial license', thanks: 'Thank you for licensing Hronaut', heading: 'Activate Hronaut for commercial use', description: 'Hronaut is source-available under PolyForm Noncommercial 1.0.0. Commercial use requires an active paid subscription.', active: 'Commercial license {key} is active on this device.', activations: '{used} of {limit} device activations used.', unlimited: 'unlimited', lastChecked: 'Last checked {time}.', checking: 'Checking…', check: 'Check license', manage: 'Manage subscription ↗', deactivating: 'Deactivating…', deactivate: 'Deactivate device', activateDescription: 'Activate the commercial license key from your Creem receipt.', secure: 'The key is encrypted with your operating system secure storage and is used only for Creem license validation.', unavailable: 'License activation requires an operating-system secure storage backend.', key: 'Commercial license key', placeholder: 'XXXX-XXXX-XXXX-XXXX', activating: 'Activating…', activate: 'Activate commercial license', support: 'Buy commercial license ↗', alternatives: 'License and community', license: 'PolyForm Noncommercial license ↗', contributing: 'Contributing guide ↗', issue: 'Report an issue ↗' }
  },
  wallets: {
    heading: 'Wallets',
    description: 'Local EVM, Solana, and Tron wallets. Websites and agents receive public descriptors only; Hronaut signs in its trusted main process.',
    status: '{status} {backend}',
    statusWithReason: '{status} {backend} {reason}',
    statuses: {
      ready: 'Managed wallets are ready.',
      locked: 'Managed wallets are locked.',
      'passphrase-setup-required': 'Managed wallets need a vault passphrase.',
      disabled: 'Managed wallets are disabled.'
    },
    backends: {
      safeStorage: 'Protected by operating-system secure storage.',
      keychain: 'Protected by macOS Keychain.',
      dpapi: 'Protected by Windows DPAPI.',
      libsecret: 'Protected by the Linux secret service.',
      kwallet: 'Protected by KDE Wallet.',
      passphrase: 'Operating-system secret store unavailable; Argon2id passphrase protection is required.',
      unavailable: 'No secure key-protection backend is available.',
      initializing: 'Wallet security is starting.'
    },
    createPassphrase: 'Create vault passphrase',
    createPassphraseDescription: 'Linux has no secure OS credential backend. Use at least 12 characters; Hronaut uses Argon2id and never silently falls back to basic_text.',
    createEncryptedVault: 'Create encrypted vault',
    unlockVault: 'Unlock wallet vault',
    unlockPassphraseDescription: 'Enter your vault passphrase to restore managed wallet signing. Ordinary browsing and watch-only wallets remain available while it is locked.',
    signingLocked: 'Wallet signing is locked',
    signingLockedDescription: 'Decrypted signing keys are no longer in memory. Ordinary browsing and watch-only wallets remain available; unlock through your operating-system secure storage when you need managed signing again.',
    unlockSystemStorage: 'Unlock with system secure storage',
    vaultPassphrase: 'Vault passphrase',
    unlock: 'Unlock',
    addWallet: 'Add wallet',
    secretsNotCopied: 'Secrets are never copied automatically.',
    modes: { generate: 'Generate', import: 'Import', watch: 'Watch only' },
    modeDescriptions: {
      generate: 'Create a new signing account and recovery phrase.',
      import: 'Bring an existing recovery phrase or private key into encrypted local storage.',
      watch: 'Track an address without storing a signing key.'
    },
    onboardingActions: {
      generate: 'Generate wallet',
      import: 'Validate and review',
      watch: 'Add watch-only wallet'
    },
    walletType: 'Wallet type',
    name: 'Name',
    chain: 'Chain',
    chains: { evm: 'EVM', solana: 'Solana', tron: 'Tron' },
    networkSetup: 'Network setup',
    networkSetupDescription: 'Start from a known network, then keep its public RPC or enter your own endpoint.',
    networkPreset: 'Network preset',
    customNetwork: 'Custom network',
    environment: 'Environment',
    environments: { local: 'Local', testnet: 'Testnet', mainnet: 'Mainnet' },
    networkId: 'Network ID',
    networkName: 'Network name',
    networkIdRequired: 'Enter a network or cluster identifier.',
    networkNameRequired: 'Enter a network name.',
    rpcUrl: 'RPC URL',
    rpcUrlInvalid: 'Enter a valid HTTP or HTTPS RPC URL.',
    evmChainId: 'EVM chain ID',
    evmChainIdInvalid: 'Enter a positive whole number within the safe integer range.',
    evmRpcUrl: 'JSON-RPC URL',
    solanaCluster: 'Solana cluster',
    solanaRpcUrl: 'Solana RPC endpoint',
    tronNetwork: 'TRON network',
    tronRpcUrl: 'Full node HTTP URL',
    publicRpcNotice: 'Built-in public RPCs are convenient defaults and may be rate-limited. You can replace the endpoint without changing the selected network.',
    mainnetWarning: 'Mainnet uses real funds and defaults to trusted human approval. Only an explicit, fully bounded Bypass Approve policy on a dedicated EVM agent wallet can skip the per-request dialog.',
    tronMainnetWarning: 'TronGrid may require a protected API key for production traffic. Hronaut does not put API keys in wallet URLs; use a dedicated or self-hosted custom endpoint.',
    publicAddress: 'Public address',
    secretFormat: 'Secret format',
    mnemonic: 'Mnemonic',
    mnemonicInput: 'Mnemonic / recovery phrase',
    privateKey: 'Private key',
    recoveryMaterial: 'Recovery material',
    dedicatedAgent: 'Dedicated agent wallet',
    dedicatedAgentDescription: 'Marks this account as dedicated to agent-requested work. It does not let an agent approve its own request or grant broader workspace access; simulation, policy limits, and trusted approval apply unless you later create an exact Bypass Approve policy.',
    attachedWorkspaces: 'Attached workspaces',
    validateImport: 'Validate wallet secret',
    importValidateStep: 'Step 1 of 2 · Validate secret',
    importAddStep: 'Step 2 of 2 · Add wallet',
    walletValidated: 'Wallet validated',
    importValidatedDescription: 'Review the public details below. The secret was cleared from the form and will be encrypted locally only when you add this wallet.',
    confirmDerivedAddress: 'Confirm derived address',
    confirmAndEncrypt: 'Confirm and encrypt',
    addEncryptedWallet: 'Add encrypted wallet',
    noWorkspaceAccess: 'No workspace access',
    cancel: 'Cancel',
    configured: 'Configured wallets',
    yourWallets: 'Your wallets',
    configuredCount: '{count} configured',
    walletToManage: 'Wallet to manage',
    noWalletsConfigured: 'No wallets configured yet',
    noWalletsConfiguredDescription: 'Choose Generate, Import, or Watch only above. Hronaut will show the wallet here after you finish adding it.',
    signingVault: 'Signing-key protection',
    lockVaultDescription: 'Locking removes decrypted signing keys and wallet authority data from memory and pauses managed signing. It does not close tabs, interrupt ordinary browsing, or disable watch-only wallets.',
    lockSigningKeys: 'Lock signing keys',
    selectWallet: 'Select a wallet',
    walletOption: '{name} · {chain} · {kind}',
    address: 'Address',
    network: 'Network',
    networkValue: '{name} ({environment})',
    rpcEndpoint: 'RPC endpoint',
    capabilities: 'Capabilities',
    recovery: 'Recovery',
    recoveryConfirmed: 'confirmed',
    recoveryRequired: 'confirmation required before signing',
    workspaceAccess: 'Workspace access',
    workspaceAccessHeading: 'Where can this wallet be used?',
    workspaceAccessDescription: 'Websites and agents in those workspaces can discover and request this wallet. Its address still requires permission, and signing still follows trusted approval and policy rules.',
    selectedWorkspaces: 'Selected workspaces',
    selectedWorkspacesDescription: 'Limit discovery and requests to only the workspaces you choose below.',
    anyWorkspace: 'Any workspace',
    anyWorkspaceDescription: 'Make this wallet discoverable in every workspace. This includes workspaces created later.',
    chooseWorkspaces: 'Choose workspaces',
    noWorkspaces: 'No workspaces exist yet. Create one first or choose Any workspace.',
    workspaceAccessSecurity: 'Changing access revokes address permissions and cancels pending requests in workspaces that lose access. It never grants signing approval automatically.',
    saveWorkspaceAccess: 'Save workspace access',
    rename: 'Rename',
    walletName: 'Wallet name',
    saveName: 'Save name',
    changeRpc: 'Change RPC endpoint',
    saveRpc: 'Save RPC endpoint',
    rpcChangeWarning: 'Changing the RPC cancels pending wallet requests and removes bounded automatic policies. The wallet address, signing identity, chain, and attached workspaces stay unchanged.',
    remove: 'Remove',
    newName: 'New wallet name',
    removeConfirm: 'Remove {name}? This cannot recover its secret material.',
    boundedHeading: 'Bounded agent automation',
    boundedDescription: 'Automatic policies are exact and limited. Unknown actions, unlimited approvals, new programs/contracts, blind messages, and failed simulations always ask.',
    watchOnlyAutomationUnavailable: 'Watch-only wallets cannot sign, so they do not need transaction automation. You can still review and remove any previously saved policies below.',
    bypassApprove: 'Bypass Approve mode',
    bypassApproveDescription: 'Matching agent transactions run without a per-request approval dialog. Mainnet requires this dedicated EVM agent wallet plus one origin, destination, method, network, complete amount/spend/fee limits, at most 100 operations, successful simulation, and an expiry within 7 days.',
    bypassApproveUnavailable: 'Mainnet Bypass Approve mode is available only for dedicated EVM agent wallets. Websites, ordinary wallets, Solana, TRON, and message signing still require trusted approval.',
    enableBypassApprove: 'Enable Bypass Approve',
    policyName: 'Bounded {network} policy',
    policyWorkspace: 'Policy workspace',
    selectPolicyWorkspace: 'Select an attached workspace',
    policyWorkspaceRequired: 'Attach this wallet to a workspace and save workspace access before adding an automation policy.',
    allowedOrigin: 'Allowed origin',
    originPlaceholder: 'https://dapp.example',
    destinationContract: 'Destination / contract',
    methodInstruction: 'Method / instruction',
    methodPlaceholder: 'native-transfer',
    maxNativeAmount: 'Max native amount',
    maxTokenAmount: 'Max token amount',
    maxFee: 'Max fee',
    sessionSpend: 'Session native spend',
    dailySpend: 'Daily native spend',
    operationCount: 'Operation count',
    expires: 'Expires',
    addBoundedPolicy: 'Add bounded policy',
    policyValue: '{mode} · {origins}',
    policyBypassValue: 'Bypass Approve · agent only · {origins}',
    websitePermissions: 'Website permissions',
    permissionValue: '{workspace} · expires {expires}',
    revoke: 'Revoke',
    requestsAudit: 'Requests and audit history',
    requestsAuditCount: '{requests} durable requests · {events} hash-chained audit events',
    refresh: 'Refresh',
    recentAudit: 'Recent audit events',
    auditValue: '{time} · #{sequence}',
    approval: {
      eyebrow: 'Trusted Hronaut approval',
      operation: '{operation}',
      description: 'A website or coding agent cannot approve this request. Verify every field before continuing.',
      wallet: 'Wallet',
      account: 'Account',
      network: 'Network',
      origin: 'Origin',
      workspace: 'Workspace',
      requester: 'Requester',
      requesterValue: '{name} ({type})',
      method: 'Method',
      destination: 'Destination',
      nativeAmount: 'Native amount',
      tokenAmount: 'Token amount',
      estimatedFee: 'Estimated fee',
      simulation: 'Simulation',
      successful: 'Successful',
      failed: 'Failed',
      unavailable: 'Not available',
      expires: 'Expires',
      undecodable: 'Hronaut could not fully decode this request. Approval requires extra care.',
      raw: 'Raw unsigned request',
      hash: 'Approval hash',
      hashPending: 'calculated on approval',
      reject: 'Reject',
      approve: 'Approve exact request'
    }
  },
  workspaceNavigationAudit: { reasonCredentials: 'embedded credentials', reasonMalformed: 'invalid address', reasonUnsupportedScheme: 'unsupported scheme', reasonNoMatch: 'not on allowlist', sourceDirect: 'address or agent request', sourcePage: 'page navigation', sourceRedirect: 'redirect', sourcePopup: 'popup', sourceHistory: 'back or forward', sourcePolicyChange: 'policy change', sourceRestore: 'session restore' },
  workspaceEditor: { kicker: 'Browser workspace', create: 'Create workspace', edit: 'Edit workspace', close: 'Close workspace editor', name: 'Workspace name', color: 'Color', siteAccess: 'Site access', siteAccessDescription: 'Optionally limit every top-level navigation in this workspace. Agents cannot change this policy.', unrestricted: 'Any safe website', unrestrictedDescription: 'Allow HTTP, HTTPS, and non-privileged browser documents.', restricted: 'Only listed sites', restrictedDescription: 'Block direct navigation, redirects, page links, forms, popups, and history entries outside this list.', allowedSites: 'Allowed site rules', allowedSitesPlaceholder: 'https://app.example\n*.trusted.example\nhttp://localhost:*', allowedSitesHelp: 'One rule per line. Use an exact HTTP(S) origin, *.example.com for subdomains, or a loopback port wildcard such as http://localhost:*.', blockedAttempts: 'Blocked navigation attempts ({count})', auditLoading: 'Loading the local navigation log…', auditError: 'The local navigation log could not be loaded.', auditEmpty: 'No navigation attempts have been blocked for this workspace.', startingData: 'Starting browser data', startingDescription: 'Choose whether this workspace starts clean or receives selected data from Default.', scratch: 'Start from scratch', scratchDescription: 'Use an empty isolated browser profile.', fork: 'Fork Default', forkDescription: 'Copy cookies and local storage without linking future changes.', websites: 'Websites to copy', clear: 'Clear', selectAll: 'Select all', noOrigins: 'No known website origins yet. Hronaut will still copy Default cookies.', defaultDescription: 'Default is the shared durable browser profile. Human-created tabs open here, agents are instructed not to use it, and it cannot be closed or deleted.', browserData: 'Browser data', browserDataDescription: 'This workspace has an isolated profile. Transfers merge data; they do not create a live connection.', transferDirection: 'Storage transfer direction', importDefault: 'Import from Default', saveDefault: 'Save to Default', loading: 'Loading known websites…', noSourceOrigins: 'No known website origins in the source profile. All cookies can still be copied.', copying: 'Copying…', creating: 'Creating workspace…', saving: 'Saving workspace…', closing: 'Closing workspace…', importSelected: 'Import selected data', saveSelected: 'Save selected data to Default', closePermanently: 'Close workspace permanently', closeDescription: 'Closes its tabs and deletes its isolated browser data.', unlockTitle: 'Unlock all tabs before closing a workspace', closeWorkspace: 'Close workspace', cancel: 'Cancel', save: 'Save changes' },
  credentialPicker: { kicker: 'Saved locally', heading: 'Choose an account', close: 'Close account chooser', search: 'Search saved accounts', placeholder: 'Search usernames', results: 'Saved accounts for this website', unnamed: 'Unnamed account', empty: 'No matching accounts', tryAnother: 'Try another username.', paused: 'Filling pauses new agent commands and leaves agents paused.', select: 'Select', fill: 'Fill' },
  commandPalette: { kicker: 'Quick actions', heading: 'Commands', close: 'Close command palette', search: 'Search commands', placeholder: 'Type a command or feature', matches: '{count} matching command. | {count} matching commands.', selected: 'Selected {label}.', available: 'Available commands', empty: 'No matching commands', emptyDescription: 'Try a feature, action, or synonym such as “screenshot” or “cookies”.', navigate: 'Navigate', run: 'Run' },
  commandCatalog: {
    categories: { Navigation: 'Navigation', 'Current website': 'Current website', Application: 'Application' },
    commands: {
      home: { label: 'Open Hronaut Home', description: 'Show the application dashboard' }, 'new-tab': { label: 'New tab', description: 'Open a blank tab in the Default workspace' }, 'search-tabs': { label: 'Search tabs', description: 'Find open, saved, and recently closed websites' }, downloads: { label: 'Show downloads', description: 'Review current and completed downloads' }, bookmarks: { label: 'Show bookmarks', description: 'Open locally saved pages' }, history: { label: 'Show browsing history', description: 'Search locally visited pages' }, find: { label: 'Find in page', description: 'Search text in the current website' }, reload: { label: 'Reload page', description: 'Reload the current website' }, 'reload-ignoring-cache': { label: 'Reload without cache', description: 'Fetch the current website again from the network' },
      'capture-area': { label: 'Capture area screenshot', description: 'Select an area and copy its PNG for an agent chat' }, 'capture-element': { label: 'Capture element screenshot', description: 'Pick one element and copy its complete PNG for an agent chat' }, 'capture-viewport': { label: 'Capture viewport screenshot', description: 'Copy the visible website as a PNG for an agent chat' }, 'capture-full-page': { label: 'Capture full-page screenshot', description: 'Copy the complete scrollable page as a PNG for an agent chat' }, 'copy-snapshot': { label: 'Copy page snapshot for agent', description: 'Copy bounded headings, controls, and visible text for an agent chat' }, 'pick-element': { label: 'Pick element for agent', description: 'Copy safe DOM context from the current website' },
      'page-tools': { label: 'Open Page tools', description: 'Browse all current-website diagnostics' }, 'site-storage': { label: 'Inspect site storage', description: 'Review cookies, databases, workers, and browser storage' }, 'responsive-preview': { label: 'Open responsive preview', description: 'Test phone, tablet, and desktop viewports' }, environment: { label: 'Open Environment', description: 'Emulate browser and device conditions' }, console: { label: 'Open Console', description: 'Inspect errors, call stacks, and grouped messages' }, network: { label: 'Open Network monitor', description: 'Inspect HTTP, WebSocket, timing, and sanitized HAR' }, 'request-conditions': { label: 'Open Request conditions', description: 'Temporarily block, mock, throttle, or prioritize requests' }, issues: { label: 'Open browser issues', description: 'Review security and compatibility diagnostics' }, 'debug-report': { label: 'Create debug report', description: 'Collect bounded console and failed-request evidence' }, 'repro-recorder': { label: 'Open repro recorder', description: 'Record safe steps for reproducing a problem' }, 'dom-changes': { label: 'Record DOM changes', description: 'See which page structures change after an action' }, 'visual-compare': { label: 'Open visual compare', description: 'Compare the current page with a baseline' },
      'quality-audit': { label: 'Run quality audit', description: 'Check accessibility, speed, metadata, security, PWA, and browser issues' }, accessibility: { label: 'Run accessibility audit', description: 'Check the current website against WCAG AA' }, performance: { label: 'Measure page performance', description: 'Collect current navigation and rendering metrics' }, 'design-overview': { label: 'Capture design overview', description: 'Review computed colors, typography, and contrast' }, 'page-metadata': { label: 'Inspect page metadata', description: 'Review search, social, canonical, and structured data signals' }, security: { label: 'Inspect connection security', description: 'Review TLS and certificate details for the current page' }, coverage: { label: 'Record code coverage', description: 'Find unused JavaScript and CSS bytes' }, 'cpu-profile': { label: 'Record JavaScript CPU profile', description: 'Find hot JavaScript functions by sampled self time' }, memory: { label: 'Measure page memory', description: 'Inspect heap and DOM counters or sample retained allocations' }, 'developer-tools': { label: 'Toggle Developer Tools', description: 'Open Chromium DevTools for the current website' },
      settings: { label: 'Open Settings', description: 'Change Hronaut preferences' }, privacy: { label: 'Open Privacy & data', description: 'Clear data for one website or the whole profile' }, 'site-permissions': { label: 'Open Site permissions', description: 'Review saved permission decisions' }, 'mcp-security': { label: 'Open MCP security', description: 'Change authentication and server port' }, updates: { label: 'Check for updates', description: 'Open software update settings' }, 'keyboard-shortcuts': { label: 'Show keyboard shortcuts', description: 'Review Hronaut keyboard controls' }, 'toggle-mcp-pause': { label: 'Pause or resume agents', description: 'Control whether Hronaut accepts new MCP commands' }
    }
  },
  help: { kicker: 'Hronaut help', shortcuts: 'Keyboard shortcuts', about: 'About Hronaut', close: 'Close help', shortcutsDescription: 'Use these shortcuts from Hronaut or from the website currently in focus.', developmentBuild: 'Development build', description: 'A persistent, visible browser that coding agents can navigate with you through MCP.', repository: 'GitHub repository', license: 'PolyForm Noncommercial license', contribute: 'Contribute', support: 'Commercial license' },
  runtime: {
    initializingStorage: 'Secure storage is initializing.',
    shortcuts: { address: 'Focus the address bar', reload: 'Reload the current website', reloadFresh: 'Reload without cached files', newTab: 'Open a new tab', closeTab: 'Close the current tab', reopenTab: 'Reopen the last closed tab', searchTabs: 'Search open tabs', commands: 'Open the command palette', pick: 'Pick an element for agent context', find: 'Find on the current page', bookmark: 'Bookmark the current page', history: 'Open browsing history', clearData: 'Clear browsing data', devtools: 'Toggle developer tools', nextTab: 'Move to the next tab', previousTab: 'Move to the previous tab', directTab: 'Move to website tab 1–8', lastTab: 'Move to the last website tab', resetZoom: 'Reset page zoom' },
    responsive: { preview: 'Test phones, tablets, and desktops', at: '{size} at {scale}×', invalid: 'Enter a width and height from 200 to 3840, with DPR from 0.5 to 5.', summary: '{size} CSS px · {scale}× DPR · {rendering} rendering · {input}', mobile: 'mobile', desktop: 'desktop', touch: 'touch', pointer: 'pointer' },
    tool: { environmentApplying: 'Applying browser conditions', environmentAttention: 'Environment needs attention', environmentDescription: 'Network, cache, service workers, CPU, animations, rendering, runtime, region, identity, and location', accessibilityRunning: 'Running accessibility audit', accessibilityAttention: 'Accessibility audit needs attention', accessibilityResult: 'Accessibility audit: {count} violation | Accessibility audit: {count} violations', accessibilityRun: 'Run accessibility audit', qualityRunning: 'Checking six evidence categories', qualityAttention: 'Quality audit needs attention', qualityClear: 'All applicable categories clear', qualityResult: '{errors} error · {warnings} warning | {errors} errors · {warnings} warnings', qualityDescription: 'Accessibility, speed, SEO, security, PWA, and browser issues', performanceRunning: 'Measuring page performance', performanceAttention: 'Performance report needs attention', performanceView: 'View page performance', performanceRun: 'Measure page performance' },
    downloads: { progress: '{count} download in progress | {count} downloads in progress', complete: 'Download complete: {filename}', recent: 'Recent downloads', heading: 'Downloads' },
    mcp: { copied: 'MCP URL copied', starting: 'MCP starting', paused: 'Agents paused', error: 'MCP error', ready: 'MCP ready', failed: 'MCP failed: {error}', startingAt: 'MCP is starting at {url}', title: 'MCP: {url}', unknown: 'Unknown startup error', resumeCommands: 'Resume new MCP commands', pauseCommands: 'Pause new MCP commands', unavailable: 'MCP server is unavailable', resumeAgents: 'Resume agents', pauseAgents: 'Pause agents' },
    capture: { cancelElementScreenshot: 'Cancel element screenshot selection', cancelElement: 'Cancel element selection', elementScreenshotCopied: 'Element screenshot copied — paste it into agent chat', elementCopied: 'Element copied for agent', elementScreenshotFailed: 'Could not copy the element screenshot', elementFailed: 'Could not select an element', selectElement: 'Select an element to copy for agent', selectScreenshot: 'Select an element and copy its screenshot', cancelArea: 'Cancel area screenshot', capturingFull: 'Capturing full-page screenshot', capturingViewport: 'Capturing viewport screenshot', viewportCopied: 'Viewport screenshot copied — paste it into agent chat', fullCopied: 'Full-page screenshot copied — paste it into agent chat', areaCopied: 'Area screenshot copied — paste it into agent chat', failed: 'Could not capture this screenshot', area: 'Capture an area to the clipboard', pastePng: 'Paste the PNG into your agent chat.', safeContext: 'Safe DOM context is ready to paste into your agent chat.', screenshotFailed: 'Screenshot failed', copyFailed: 'Copy failed', clipboardFailed: 'The system clipboard did not accept the text.' },
    locks: { websiteOnly: 'Tab lock is available on websites', allLocked: 'Human page input and tab closing are blocked; Hronaut controls and agents keep working', unlockTab: 'Unlock page input in this tab', lockTab: 'Lock page input in this tab', unlockAll: 'Allow human page input and tab closing in all website tabs. Focus protection stays automatic.', lockAll: 'Block human page input and tab closing in all website tabs; Hronaut controls and agents keep working. Focus protection stays automatic.', unlockToClose: 'Unlock all tabs to close this tab', closeShortcut: 'Close tab (Ctrl/Cmd+W)', closeUnavailable: 'Close tab unavailable while all tabs are locked', inputLocked: 'Page input is locked', inputLock: 'Page input lock' },
    pdf: { saving: 'Saving page as PDF', saved: 'PDF saved to {path}', directory: 'the download directory', failed: 'Could not save page as PDF', save: 'Save page as PDF' },
    storage: { local: 'Local storage', session: 'Session storage', cookie: 'Cookie', cookies: 'Cookies', cacheStorage: 'Cache Storage', indexedDb: 'IndexedDB', serviceWorkers: 'Service workers', shared: 'Shared storage', buckets: 'Storage buckets', files: 'File systems', webSql: 'Web SQL', shader: 'Shader cache', systemDownloads: 'System Downloads folder', attribute: 'Attribute' },
    workspace: { newName: 'New workspace', unlock: 'Unlock all tabs before closing a workspace.', restoreFailed: 'Restore workspace failed', restoreDescription: 'The archived workspace could not be restored.', deleteFailed: 'Delete workspace failed', deleteDescription: 'The archived workspace could not be deleted.', openFailed: 'Open tab failed', openDescription: 'The selected tab could not be opened.', newTabFailed: 'New tab failed', newTabDescription: 'A tab could not be opened in {workspace}.', splitFailed: 'Split view failed' },
    browsingData: { cleared: 'Selected data was cleared for all websites. Reload open pages when you are ready. | Selected data were cleared for all websites. Reload open pages when you are ready.' },
    navigation: { failed: 'Navigation failed', failedDescription: 'The address could not be opened.' },
    emulation: { normal: 'Normal network', cacheDisabled: 'Cache disabled', workerBypassed: 'Service worker bypassed', dataSaverOn: 'Data Saver on', dataSaverOff: 'Data Saver off', jsDisabled: 'JavaScript disabled', location: 'Location override', animationsPaused: 'Animations paused', animations: 'Animations {percent}', darkMode: 'Dark mode', lightMode: 'Light mode', reducedMotion: 'Reduced motion', fullMotion: 'Full motion', printMedia: 'Print media', screenMedia: 'Screen media', forcedColors: 'Forced colors', noForcedColors: 'No forced colors', reducedTransparency: 'Reduced transparency', fullTransparency: 'Full transparency', paint: 'Paint flashing', shifts: 'Layout shifts', layers: 'Layer borders', frames: 'Frame stats', scroll: 'Scroll issues', custom: 'Custom browser', reset: 'Reset tab emulation: {description}' },
    suggestion: { bookmark: 'Bookmark', history: 'History', visits: 'History · {count} visits' },
    network: { notObserved: 'Not observed', complete: 'Complete', pending: 'Pending', done: 'Done', removed: 'That request is no longer in the bounded Network log. Refresh and search again.' },
    toast: { pageSnapshotFailed: 'Page snapshot failed', pageSnapshotDescription: 'Could not copy the current page snapshot.', elementScreenshotCopied: 'Element screenshot copied', elementCopied: 'Element copied', elementScreenshotFailed: 'Element screenshot failed', elementFailed: 'Element selection failed', elementScreenshotDescription: 'Could not capture or copy the selected element.', elementDescription: 'Could not copy the selected element context.', areaCopied: 'Area screenshot copied', fullCopied: 'Full-page screenshot copied', viewportCopied: 'Viewport screenshot copied', settingNotSaved: 'Setting not saved', settingKept: 'Hronaut kept your previous setting.', passwordFilled: 'Password filled', passwordFilledDescription: '{username} was filled. Agents remain paused.', passwordFillFailed: 'Password fill failed', passwordFillDescription: 'The saved password could not be filled.', passwordRemoved: 'Password removed', passwordRemovedDescription: 'The saved account was removed from this device.', passwordRemoveFailed: 'Remove password failed', passwordRemoveDescription: 'The saved account could not be removed.', startupIncomplete: 'Startup incomplete', startupIncompleteDescription: 'Some Hronaut services did not finish starting. You can keep using available features.', startupRecovered: 'Startup recovered', startupRecoveredDescription: 'All Hronaut services are available again.', actionFailed: 'The requested browser action could not be completed.' },
    downloadSettings: { openingPicker: 'Opening the folder picker…', folderSelected: 'New website downloads will use this folder.', saving: 'Saving download preferences…', ask: 'Hronaut will ask where to save each new website download.', automatic: 'New website downloads will save automatically.', openingFolder: 'Opening the download folder…', restoring: 'Restoring download defaults…', restored: 'Downloads will use the default folder and save automatically.' },
    permissions: { clipboardRead: 'Clipboard read', clipboardWrite: 'Clipboard write', display: 'Screen capture', files: 'Files and folders', fullscreen: 'Fullscreen', location: 'Location', activity: 'Activity detection', media: 'Camera and microphone', notifications: 'Notifications', storage: 'Third-party storage', relatedStorage: 'Related-site storage', windows: 'Window management' },
    license: { enterKey: 'Enter the commercial license key from your Creem receipt.' },
    address: { https: 'HTTPS address', http: 'HTTP address', zoom: 'Page zoom: {percent} (Ctrl/Cmd + Plus, Minus, or 0)', responsive: 'Responsive preview: {status}', environment: 'Environment: {status}', conditions: 'Request conditions: {status}', noneActive: 'none active', quality: 'Quality audit: {status}' },
    tabs: { expand: 'Expand workspace {name} · {id}', collapse: 'Collapse workspace {name} · {id}', expandAria: 'Expand workspace {name}, {count} tab | Expand workspace {name}, {count} tabs', collapseAria: 'Collapse workspace {name}, {count} tab | Collapse workspace {name}, {count} tabs', newTab: 'New tab in {name} workspace', routes: '{count} temporary network route | {count} temporary network routes', unmute: 'Unmute {title}', mute: 'Mute {title}', unnamed: 'tab', stop: 'Stop', reload: 'Reload', siteControls: 'Site controls for {host}', siteControlsAvailable: 'Site controls are available on websites', siteControlsUnavailable: 'Site controls are unavailable', cookieAvailable: '{count} cookie available to this address | {count} cookies available to this address', loadingCookies: 'Loading cookie count', historyAvailable: '{pages} history page and {visits} visit | {pages} history pages and {visits} visits', loadingHistory: 'Loading history count', bookmarkSaved: 'Bookmarks — current page saved (Ctrl/Cmd+D to remove)', bookmarkSave: 'Bookmarks (Ctrl/Cmd+D to save current page)', splitWith: 'Split view with {title}', splitOther: 'another tab', splitOpen: 'Open two tabs in split view', siteStorage: 'Site storage for {host}', siteStorageUnavailable: 'Site storage is unavailable', dockSiteControls: 'Dock site controls', dockPageTools: 'Dock page tools' }
  },
  runtimeActions: {
    pageSnapshot: { copied: 'Page snapshot copied', ready: '{count} characters of headings, controls, and visible text are ready to paste into your agent chat{limit}', bounded: ' (bounded at 30,000 characters).', period: '.' },
    capture: { areaFallback: 'Could not capture this area.', areaCopyFailed: 'Could not copy area: {error}', pageFallback: 'Could not capture the {area}.', pageCopyFailed: 'Could not copy {area}: {error}', fullPage: 'full page', viewport: 'viewport' },
    memory: { minutes: '{count} minute | {count} minutes', hours: '{count} hour | {count} hours' },
    mcp: { disableConfirm: 'Disable MCP authentication? Any process on this computer will be able to control your logged-in browser and attach local files.', invalidPort: 'Choose a whole number from {min} through {max}.', moving: 'Moving the MCP listener to port {port}…', active: 'MCP port {port} is active.', endpoint: 'Active endpoint: {url}' },
    actionFailure: { reload: 'Reload failed', saveLink: 'Save link failed', generic: 'Browser action failed' },
    credential: { noLongerMatches: 'The saved account no longer matches this website.', noLongerExists: 'The saved account no longer exists.' },
    workspace: { copied: '{cookies} cookies and {items} local storage items copied.', closeConfirm: 'Close workspace “{name}”? Its tabs, cookies, local storage, cache, and other private browser data will be permanently deleted.', deleteConfirm: 'Delete archived workspace “{name}” and its {count} saved tab? Its isolated browser data will also be deleted. | Delete archived workspace “{name}” and its {count} saved tabs? Its isolated browser data will also be deleted.', splitOpen: 'The selected tab could not be opened in split view.', splitLayout: 'The split-view layout could not be changed.', splitSize: 'The split-view size could not be changed.', splitSwap: 'The split-view panes could not be swapped.', splitClose: 'Split view could not be closed.' },
    browsingData: { confirm: 'Clear the selected browsing data for all websites?\n\n{items}\n\nBookmarks, downloaded files, saved passwords, and site-permission decisions will remain. Open pages will not reload automatically.', item: '• {item}', websiteConfirm: 'Clear {items} for {origin}? Open pages will not reload automatically.', cookieMeta: '{count} cookie | {count} cookies', historyMeta: '{count} history page | {count} history pages', bookmarkMeta: '{count} bookmark | {count} bookmarks', passwordMeta: '{count} saved account | {count} saved accounts', permissionMeta: '{count} permission decision | {count} permission decisions', tabMeta: '{count} open Default tab | {count} open Default tabs', clearedSite: 'Selected data was cleared for {origin}. Reload open pages when you are ready. | Selected data were cleared for {origin}. Reload open pages when you are ready.' },
    permission: { aria: '{permission} permission for {origin}', forgetAria: 'Forget {permission} permission for {origin}', resetAria: 'Reset {permission} permission for {origin}' }
  },
  privacyActions: { clearHistory: 'Clear all browsing history? This will not remove cookies, passwords, bookmarks, or downloaded files.', historyAll: 'Browsing history and its address suggestions', historySite: 'Browsing history and address suggestions', cookiesAll: 'Cookies and site data (you may be signed out)', cookiesSite: 'Cookies and site storage (you may be signed out)', cache: 'Cached images and files', clearSiteConfirm: 'Clear the selected data for {origin}?\n\n{items}\n\nRelated subdomains may share cookies. Bookmarks, saved passwords, site permissions, downloads, settings, and open tabs will remain.', historyWithVisits: '{pages} history page · {visits} visit | {pages} history pages · {visits} visits', openTabs: '{count} open tab | {count} open tabs', bookmarksKept: '{count} bookmark kept | {count} bookmarks kept', accountsKept: '{count} saved account kept | {count} saved accounts kept', decisionsKept: '{count} permission decision kept | {count} permission decisions kept', clearedSite: 'Selected data was cleared for {origin}. Open pages were left in place.' },
  runtimeDetails: { clearStorage: 'Clear {kind} for {host}?{note}', httpOnlyNote: ' HttpOnly cookies will remain protected.', headers: '{count} request header | {count} request headers', emulation: { cache: 'HTTP cache disabled', worker: 'service worker bypassed', dataSaver: 'Data Saver {state}', on: 'on', off: 'off', js: 'JavaScript disabled', viewport: '{size} at {scale}×{mobile}{touch} {orientation} viewport', mobile: ' mobile', touch: ' touch', geolocation: 'custom geolocation', locale: '{locale} locale', timezone: '{timezone} time zone', cpu: 'CPU {rate}× slower', animationsPaused: 'animations paused', animations: 'animations at {percent} speed', color: '{scheme} color scheme', reducedMotion: 'reduced motion', fullMotion: 'no reduced motion', media: '{media} media', forced: 'forced colors {state}', contrast: '{contrast} contrast preference', reducedTransparency: 'reduced transparency', fullTransparency: 'no reduced transparency', vision: '{vision} simulation', paint: 'paint flashing', shifts: 'layout shift regions', layers: 'layer borders', frames: 'frame rendering stats', scroll: 'scrolling performance issues', userAgent: 'custom user agent', customHeaders: '{count} custom request header | {count} custom request headers', custom: 'custom browser conditions' }, tab: { pinned: ' — pinned', sleeping: ' — sleeping; reloads when selected', muted: ' — muted', audio: ' — playing audio', locked: ' — page input locked', problem: ' — {problem}', emulated: ' — emulated: {description}', routes: ' — {count} temporary network route |  — {count} temporary network routes', split: ' — visible in split view', workspace: ' — workspace: {name}', exit: '{reason} · exit {code}' }, performance: { anonymous: 'Anonymous script work', unavailable: 'Source unavailable', delta: '{value} vs baseline', character: '{source} · char {position}' }, networkHeadersError: 'Response headers must be a JSON object with string values.', deactivate: 'Deactivate this Hronaut installation and free its device slot?', browserAction: 'Browser action failed' },
  networkReplayStatus: { confirm: 'Replaying {method} can repeat writes or other side effects. Click again to confirm.', replaying: 'Replaying {method} XHR inside this tab…', replayed: 'Replayed {method} XHR. The new request is selected for inspection.' },
  shell: {
    home: { open: 'Open Hronaut Home', label: 'Home' },
    loading: 'Loading',
    tabs: {
      navigation: 'Tab navigation', list: 'Browser tabs and workspaces', scrollBack: 'Show previous tabs', scrollForward: 'Show more tabs', defaultWorkspace: 'Default workspace for new tabs', pageAttention: 'Page needs attention', sleeping: 'Sleeping to save resources', stackedVisible: 'Visible in stacked split view', sideVisible: 'Visible in side-by-side split view', inputLocked: 'Page input locked',
      createWorkspaceTitle: 'Create a new isolated workspace', createWorkspace: 'Create workspace', workspace: 'Workspace', collapseRail: 'Collapse tab rail when not in use', keepRailExpanded: 'Keep tab rail expanded', locked: 'Input blocked', lock: 'Block input'
    },
    actions: {
      commandsTitle: 'Commands (Ctrl/Cmd+Shift+P)', commands: 'Open command palette', searchTabsTitle: 'Search tabs (Ctrl/Cmd+Shift+A)', searchTabs: 'Search tabs', historyTitle: 'Browsing history (Ctrl+H / Cmd+Y)', history: 'Browsing history', settings: 'Settings'
    },
    toolbar: { back: 'Back', forward: 'Forward', address: 'Address', addressPlaceholder: 'Search or enter address', findTitle: 'Find in page (Ctrl/Cmd+F)', find: 'Find in page', zoom: 'Page zoom controls', bookmarks: 'Bookmarks' },
    siteControls: {
      close: 'Close site controls', cookie: 'cookie', cookies: 'cookies', historyPage: 'history page', historyPages: 'history pages', visit: 'visit', visits: 'visits', permissions: 'Permissions', defaults: 'Using defaults', allow: 'Allow', block: 'Block', reset: 'Reset to default', empty: 'No custom decisions for this website. Hronaut will ask when a permission is needed.', allSettings: 'All site settings', clearData: 'Clear data for this website'
    },
    suggestions: 'Local address suggestions',
    split: { tab: 'Tab', heading: 'Split view', workspace: 'Workspace', closeMenu: 'Close split view menu', with: 'with', layout: 'Split layout', side: 'Side by side', stacked: 'Stacked', first: 'First pane', swap: 'Swap panes', exit: 'Exit split view', choose: 'Choose a tab to show on the right of {page}.', thisPage: 'this page', newTab: 'New tab', noWorkspace: 'No workspace' },
    pageTools: {
      heading: 'Page tools', current: 'Current website', close: 'Close page tools', inspect: 'Inspect & simulate', storageDescription: 'Cookies and browser storage', responsive: 'Responsive preview', environment: 'Environment', openConsole: 'Open Console', consoleDescription: 'Errors, call stacks, and grouped messages', openNetwork: 'Open network monitor', networkDescription: 'HTTP, WebSocket, timing, and sanitized HAR', conditions: 'Request conditions', conditionsDescription: 'Block, mock, or throttle requests', routeCount: '{count} condition | {count} conditions', openRoutes: 'Open {count} temporary request condition | Open {count} temporary request conditions', diagnose: 'Diagnose & reproduce', pickElement: 'Pick element', pickDescription: 'Copy DOM, box model, styles, and a11y', elementScreenshot: 'Element screenshot', screenshotDescription: 'Pick one component and copy its complete PNG', audit: 'Audit & optimize', javascriptCpu: 'JavaScript CPU', exportAccount: 'Export & account', copySnapshot: 'Copy page snapshot', copySnapshotAria: 'Copy page snapshot for agent', copySnapshotDescription: 'Headings, controls, and visible text', savePdf: 'Save as PDF', savedPassword: 'Saved password', fillPassword: 'Fill saved password and pause agents', noPassword: 'No saved password for this site', accountsAvailable: '{count} available · pauses agents', noAccount: 'No saved account for this site', pageActions: 'Page-specific actions'
    }
  },
  pageProblem: { reload: 'Reload', tryAgain: 'Try again' },
  responsive: {
    kicker: 'Responsive testing', heading: 'Responsive preview', close: 'Close responsive preview', preset: 'Viewport preset', presetHelp: 'Generic sizes expose layout breakpoints without pretending to be a physical device.', rotate: 'Rotate', rotateTitle: 'Rotate viewport', rotateAria: 'Rotate responsive viewport', presetAria: 'Responsive viewport preset', custom: 'Custom', range: '200–3840 px', customDescription: 'Choose exact conditions', orientation: 'Orientation', orientationHelp: 'Width and height rotate together.', orientationAria: 'Viewport orientation', portrait: 'Portrait', landscape: 'Landscape', customConditions: 'Custom conditions', cssPixels: 'Viewport values are CSS pixels.', width: 'Width', height: 'Height', dpr: 'DPR', mobile: 'Mobile rendering', touch: 'Touch events', applied: 'Viewport applied', applyingViewport: 'Applying viewport…', previewConditions: 'Preview conditions', limitation: 'Simulation changes only this website tab. It is useful for responsive debugging, but it is not a physical-device test.', reset: 'Reset viewport', applying: 'Applying…', apply: 'Apply preview'
  },
  environment: {
    kicker: 'Current website', heading: 'Environment', close: 'Close Environment',
    loading: { heading: 'Loading conditions', description: 'Reproduce slower devices and unreliable connections.' },
    network: { label: 'Network', none: 'No throttling', fast4g: 'Fast 4G', slow4g: 'Slow 4G', slow3g: 'Slow 3G', offline: 'Offline', help: 'Applies to new HTTP and WebSocket traffic.' },
    cpu: { label: 'CPU', none: 'No slowdown', x2: '2× slowdown', x4: '4× slowdown', x6: '6× slowdown', x20: '20× slowdown', help: 'Relative to this computer, not a physical device.' },
    dataSaver: { label: 'Data Saver', system: 'Use system setting', enabled: 'Enabled', disabled: 'Disabled', help: 'Overrides navigator.connection.saveData; it does not throttle bandwidth.' },
    cache: { label: 'Disable HTTP cache', help: 'Ignore memory and disk cache for new requests without deleting cached data.' },
    serviceWorker: { label: 'Bypass service worker', help: 'Send new requests to the network without unregistering the website’s worker.', offline: 'Offline blocks new network traffic until this condition is changed or all tab emulation is reset.', combined: 'Bypassing the service worker also bypasses its offline responses, so matching requests will fail while Offline is active.' },
    runtime: { heading: 'Page runtime', description: 'Inspect motion precisely or check the page’s HTML and CSS fallback without client scripts.', animation: 'Animation playback', normal: 'Normal speed', quarter: '25% speed', tenth: '10% speed', paused: 'Paused', animationHelp: 'Controls CSS Animations, transitions, and Web Animations on this tab; animation-frame scripts continue normally.', disableJs: 'Disable JavaScript', disableJsHelp: 'Reload to test startup. Hronaut controls and MCP reset remain available.', disableJsWarning: 'Page interactions and agent evaluation may stop working until JavaScript is enabled again, but Environment and Reset environment can always restore it.' },
    rendering: { heading: 'Rendering preferences', description: 'Test CSS branches driven by user preferences.', media: 'Media type', noOverride: 'No override', screen: 'Screen', print: 'Print', printHelp: "Tests {'@'}media print without opening print preview.", colorScheme: 'Color scheme', light: 'Prefer light', dark: 'Prefer dark', colorHelp: 'Emulates prefers-color-scheme.', forcedColors: 'Forced colors', active: 'Active', inactive: 'Inactive', forcedHelp: 'Tests forced-colors branches such as Windows High Contrast.', contrast: 'Contrast', more: 'Prefer more', less: 'Prefer less', custom: 'Custom', noPreference: 'No preference', contrastHelp: 'Emulates prefers-contrast.', motion: 'Motion', reduceMotion: 'Reduce motion', motionHelp: 'Emulates prefers-reduced-motion.', transparency: 'Transparency', reduceTransparency: 'Reduce transparency', transparencyHelp: 'Emulates prefers-reduced-transparency.', vision: 'Vision simulation', noSimulation: 'No simulation', blurred: 'Blurred vision', reducedContrast: 'Reduced contrast', protanopia: 'Protanopia · no red', deuteranopia: 'Deuteranopia · no green', tritanopia: 'Tritanopia · no blue', achromatopsia: 'Achromatopsia · no color', visionHelp: 'Visual simulation helps reveal color-only meaning; it is not a medical representation of every person.' },
    diagnostics: { heading: 'Rendering diagnostics', description: 'Show Chromium’s live compositor and layout evidence over this page.', paint: 'Paint flashing', paintHelp: 'Flash repainted regions in green to reveal unnecessary rendering work.', shifts: 'Layout shift regions', shiftsHelp: 'Briefly highlight content that moves unexpectedly; reload before reproducing startup shifts.', layers: 'Layer borders', layersHelp: 'Show composited layer borders and tiles over the page.', frames: 'Frame rendering stats', framesHelp: 'Display live frame timing, dropped frames, and GPU rendering information.', scrolling: 'Scrolling performance issues', scrollingHelp: 'Highlight regions with listeners or behavior that can delay scrolling.', warning: 'These diagnostics can flash rapidly. Disable them immediately if flashing content could affect you.' },
    identity: { heading: 'Region, identity & location', description: 'Overrides stay isolated to this tab.', optional: 'optional', locale: 'Locale', localePlaceholder: 'System default · en-US', localeHelp: 'Controls locale-aware formatting, language APIs, and subsequent request headers after reload.', timezone: 'Time zone', timezonePlaceholder: 'System default · Europe/Kyiv', timezoneHelp: 'Use an IANA ID to reproduce local dates and daylight-saving transitions.', userAgent: 'Custom user agent', userAgentPlaceholder: 'Use Chromium default', userAgentHelp: 'Reload to send it on the main document request.', geolocation: 'Override geolocation', geolocationHelp: 'The website still needs location permission.', latitude: 'Latitude', longitude: 'Longitude', accuracy: 'Accuracy, m' },
    other: { heading: 'Other active emulation', description: 'Applying this form preserves these separately managed conditions.', viewport: 'viewport', openResponsive: 'Open Responsive preview', agentRequest: 'agent-set request', header: 'header', headers: 'headers', hidden: '· values stay hidden' },
    applyingConditions: 'Applying conditions…', applied: 'Environment applied', checkValues: 'Check the entered values', activeCondition: '{count} active condition', activeConditions: '{count} active conditions', applyHelp: 'Apply without reload for live CSS and connection changes, or reload without cache to retest page startup.', limitation: 'Throttling is an approximation relative to this computer. Use a physical device and field data before drawing production conclusions.', reset: 'Reset environment', apply: 'Apply', applyReload: 'Apply & reload', applying: 'Applying…'
  },
  qualityAudit: {
    kicker: 'Local evidence review', heading: 'Quality audit', close: 'Close quality audit', checking: 'Checking six quality categories…', privacy: 'Hronaut combines bounded local evidence without uploading page content or inventing a score.', failed: 'Quality audit could not finish', clear: 'No automated blockers found', review: 'Review the warnings', attention: 'Quality issues need attention', errors: 'errors', warnings: 'warnings', information: 'informational', categories: 'Quality categories', categoryCount: '{count} categories · {time}', findings: 'Findings', truncated: 'Only the first 40 findings are shown and copied; category totals remain complete.', limitations: 'Scope and limitations', copied: 'Copied', copy: 'Copy report', runAgain: 'Run again'
  },
  accessibilityAudit: {
    kicker: 'Local WCAG check', heading: 'Accessibility', close: 'Close accessibility audit', checking: 'Checking the rendered page…', privacy: 'The audit runs locally and does not send page data to a service.', failed: 'Audit could not finish', violation: 'violation', violations: 'violations', critical: 'critical', serious: 'serious', review: 'review', clear: 'No automated WCAG A/AA violations found', manual: 'Manual keyboard and assistive-technology testing is still needed.', element: 'element', elements: 'elements', guidance: 'Rule guidance ↗', runAgain: 'Run again'
  },
  performance: {
    kicker: 'Current visit', heading: 'Page performance', close: 'Close performance report', collecting: 'Collecting local page metrics…', privacy: 'The measurement stays in Hronaut and does not upload page data.', failed: 'Performance report could not finish', comparedAt: 'Compared with baseline from {time}', savedAt: 'Baseline saved at {time}', urlChanged: 'The page URL changed since the baseline.', conditionsChanged: 'Viewport or browser conditions changed since the baseline.', sameConditions: 'Same page and browser conditions.', measureAfter: 'Measure again after your change to see deltas.', notObserved: 'not observed', goodLcp: 'Good ≤ 2.5 s', goodInp: 'Good ≤ 200 ms', goodCls: 'Good ≤ 0.1', loading: 'Loading', ttfb: 'TTFB', fcp: 'First contentful paint', domLoaded: 'DOM content loaded', loadEvent: 'Load event', unavailable: 'Unavailable', pageWork: 'Page work', resources: 'Resources', transferred: 'Transferred', longTasks: 'Long tasks', unsupported: 'Unsupported', blocking: 'Observed blocking time', responsiveness: 'Responsiveness', longFrames: 'Long animation frames', blockingDuration: 'Blocking duration', longestFrame: 'Longest frame', styleLayout: 'Style & layout', contributors: 'Top script contributors', frame: 'frame', frames: 'frames', forcedLayout: 'ms forced layout', contributorsLimit: 'Showing the highest-cost bounded contributors and frames.', unattributed: 'Long frames were observed, but Chromium did not attribute them to a same-origin main-thread script.', shifts: 'Layout shifts', unexpected: 'Unexpected shifts', scoreSum: 'Observed score sum', recentInput: 'After recent input', excluded: 'excluded', largestShifts: 'Largest unexpected shifts', affectedUnavailable: 'Affected element unavailable', afterNavigation: 'ms after navigation', affectedElements: 'affected elements', shiftsLimit: 'Showing the highest-scoring bounded shifts.', noShifts: 'No unexpected layout shift was observed in this visit.', userTiming: 'User timing', mark: 'mark', timingLimit: 'Showing the {shown} most recent of {total} marks and measures.', inpHelp: 'Interact with the page, then measure again to collect INP.', interpretation: 'How to interpret this report', localSample: '· local sample', clearBaseline: 'Clear baseline', replaceBaseline: 'Replace baseline', saveBaseline: 'Save baseline', measureAgain: 'Measure again'
  },
  designOverview: {
    kicker: 'Current rendering', heading: 'Design overview', close: 'Close design overview', loading: 'Reading computed page styles…', privacy: 'Page text, form values, CSS source, IDs, and class names stay out of the report.', failed: 'Design overview could not finish', tryAgain: 'Try again', toolCapturing: 'Capturing computed page styles', toolAttention: 'Design overview needs attention', toolIssueCount: '{count} likely contrast issue | {count} likely contrast issues', toolReady: 'View colors and typography', toolDescription: 'Colors, typography, and contrast', toolAria: 'Design overview: {status}',
    visibleElements: 'Visible elements', colors: 'Colors', fontCombinations: 'Font combinations', contrastIssues: 'Likely contrast issues', computedColors: 'Computed colors', colorKinds: { text: 'text', background: 'background', border: 'border' }, noVisibleColors: 'No visible {kind} colors observed.',
    typography: 'Typography', browserDefault: 'Browser default', unknownSize: 'unknown size', fontDetails: '{size} · weight {weight} · line {line}', elementCount: '{count} element | {count} elements', noFonts: 'No visible font combinations observed.', contrastHeading: 'Likely text contrast issues', contrastColors: '{foreground} on {background} · needs {ratio}:1', contrastFont: '{size} · weight {weight}', largeText: '· large text', noContrast: 'No likely failures were found in the bounded solid-background sample.', mediaQueries: 'Media queries', scope: 'Scope and limitations', sampled: '{count} element sampled | {count} elements sampled', captureAgain: 'Capture again',
    caveats: { bounded: 'This is a bounded current-rendering sample, not a complete stylesheet inventory.', crossOrigin: 'Cross-origin stylesheets can contribute computed styles, but their rules and media queries cannot be enumerated.', contrast: 'Contrast checks skip gradients and complex imagery and may not model overlays, filters, pseudo-elements, or blended backgrounds.', excluded: 'No CSS source, DOM text, form values, element IDs, class names, or page markup are returned.' }
  },
  pageMetadata: {
    kicker: 'Current rendered document', heading: 'Page metadata', close: 'Close page metadata', loading: 'Inspecting search and social metadata…', privacy: 'Only allowlisted metadata and structured-data types are collected.', failed: 'Page metadata could not be inspected', tryAgain: 'Try again', toolInspecting: 'Inspecting page metadata', toolAttention: 'Page metadata needs attention', toolWarningCount: '{count} metadata warning | {count} metadata warnings', toolReady: 'Search and social metadata ready', toolDescription: 'Search, social, and structured data', toolAria: 'Page metadata: {status}',
    actionableFindings: 'Actionable findings', h1Headings: 'H1 headings', openGraphFields: 'Open Graph fields', structuredTypes: 'Structured data types', findings: 'Findings', searchInputs: 'Search result inputs', preview: 'Approximate search result preview', untitled: 'Untitled page', noDescription: 'No meta description. A search engine may select page content for the snippet.',
    canonical: 'Canonical', language: 'Language', charset: 'Charset', robots: 'Robots', viewport: 'Viewport', themeColor: 'Theme color', manifest: 'Manifest', headingCounts: 'Heading counts', headingCountsValue: 'H1 {h1} · H2 {h2} · H3 {h3} · H4–H6 {h4to6}', socialCards: 'Social cards', openGraph: 'Open Graph', propertyCount: '{count} property | {count} properties', title: 'Title', type: 'Type', url: 'URL', description: 'Description', image: 'Image', imageAlt: 'Image alt', twitterCard: 'Twitter card', card: 'Card', structuredData: 'Structured data', noStructuredTypes: 'No JSON-LD types were found.', block: 'Block {number}', linkedMetadata: 'Linked metadata', alternateCount: '{count} language alternate | {count} language alternates', iconCount: '{count} linked icon | {count} linked icons', scope: 'Scope and limitations', renderedDom: 'Rendered DOM', inspectAgain: 'Inspect again',
    notDeclared: 'Not declared', unavailable: 'Unavailable', defaultIndexing: 'Default indexing behavior', notLinked: 'Not linked', fallbackTitle: 'Falls back to Open Graph/title', fallbackDescription: 'Falls back to Open Graph/description',
    issues: {
      missingTitle: { label: 'Missing title', message: 'Add a concise, descriptive title element.' }, multipleTitles: { label: 'Multiple titles', message: 'The document contains more than one title element.' }, missingDescription: { label: 'Missing description', message: 'No meta description is declared; search engines may generate a snippet from page content.' }, multipleDescriptions: { label: 'Multiple descriptions', message: 'The document contains more than one meta description.' }, missingCanonical: { label: 'Missing canonical', message: 'No explicit canonical link is declared.' }, multipleCanonicals: { label: 'Multiple canonicals', message: 'The document contains more than one canonical link.' }, missingLanguage: { label: 'Missing language', message: 'The root html element does not declare a language.' }, missingViewport: { label: 'Missing viewport', message: 'No viewport metadata is declared for responsive rendering.' }, robotsNoindex: { label: 'Robots noindex', message: 'The page asks compliant search engines not to index it.' }, missingH1: { label: 'Missing H1', message: 'No level-one heading is present in the rendered document.' }, multipleH1: { label: 'Multiple H1 headings', message: 'Multiple level-one headings are present; make the primary page title visually unambiguous.' }, incompleteOpenGraph: { label: 'Incomplete Open Graph', message: 'Open Graph metadata is missing {field}.' }, missingOgImageAlt: { label: 'Missing Open Graph image alt', message: 'At least one Open Graph image has no og:image:alt description.' }, missingTwitterCard: { label: 'Missing Twitter card', message: 'Twitter card metadata is present without twitter:card.' }, invalidJsonLd: { label: 'Invalid JSON-LD', message: '{count} JSON-LD block could not be parsed. | {count} JSON-LD blocks could not be parsed.' }
    },
    caveats: { rendered: 'This report describes metadata in the currently rendered DOM; crawlers may receive or process a different response.', outcomes: 'Metadata can influence search and social presentation but does not guarantee indexing, ranking, snippets, or rich results.', allowlist: 'Only an allowlist of page metadata is returned. Arbitrary meta tags, body text, form values, and complete JSON-LD objects are excluded.' }
  },
  securityReport: {
    kicker: 'Current main document', heading: 'Connection security', close: 'Close security report', loading: 'Inspecting the current connection…', privacy: 'Hronaut reads transport metadata already observed by Chromium.', failed: 'Security report could not finish', tryAgain: 'Try again', toolInspecting: 'Inspecting connection security', toolAttention: 'Security report needs attention', toolSecure: 'Secure connection', toolInsecure: 'Connection is not secure', toolState: 'Connection state: {state}', toolDescription: 'TLS, certificate, and connection details', toolAria: 'Security: {status}', secure: 'This connection is secure', insecure: 'This connection is not secure', state: 'Connection security is {state}', connection: 'Connection', encryptedTransport: 'Encrypted transport', yes: 'Yes', no: 'No', protocol: 'Protocol', cipher: 'Cipher', keyExchange: 'Key exchange', certificateTransparency: 'Certificate transparency', encryptedClientHello: 'Encrypted ClientHello', unavailable: 'Unavailable', certificate: 'Certificate', subject: 'Subject', issuer: 'Issuer', validFrom: 'Valid from', validUntil: 'Valid until', validity: 'Validity', expired: 'Expired', notYetValid: 'Not yet valid', currentlyValid: 'Currently valid', expiresIn: 'Expires in', dayCount: '{count} day | {count} days', certificateNames: '{count} certificate name | {count} certificate names', onlyFirstNames: 'Only the first {count} names are shown.', noCertificate: 'No TLS certificate details available', noCertificateDescription: 'This is expected for HTTP, local, cached, failed, or still-loading documents.', caveatsHeading: 'What this report does not prove', mainChecked: 'Main document · checked {time}', inspectAgain: 'Inspect again',
    caveats: { trust: 'This reports the transport and certificate observed for the current main document, not whether the application itself is trustworthy.', browserIssues: 'Review Browser Issues separately for mixed content, Content Security Policy, CORS, cookies, and compatibility findings.', unavailable: 'Certificate details may be unavailable for cached, service-worker, local, failed, or still-loading documents; reload and inspect again when needed.' }
  },
  coverage: {
    kicker: 'Current workflow', heading: 'Code coverage', close: 'Close code coverage', loading: 'Updating code coverage…', privacy: 'Instrumentation and source analysis stay inside Hronaut.', failed: 'Code coverage needs attention', tryAgain: 'Try again', recording: 'Coverage is recording', recordingDescription: 'Use the page paths you want to measure, then stop to calculate used and unused bytes.', recordingMeta: '{mode} mode · started {time}', stop: 'Stop and show results', used: 'Used', unused: 'Unused', ofTotal: 'of {total}', resources: 'Resources', resourceCounts: '{javascript} JS · {css} CSS', resourcesAria: 'Code coverage resources', unusedOf: '{unused} unused of {total}', noResources: 'No measurable JavaScript or CSS', noResourcesDescription: 'Reload a web page after starting coverage, then exercise it before stopping.', interpretation: 'How to interpret this report', mode: '{mode} mode', bounded: '· bounded result', clear: 'Clear', recordAgain: 'Record again', emptyHeading: 'Find unused JavaScript and CSS', emptyDescription: 'Start before loading or exercising the page. Hronaut reports byte totals without exposing source code.', precision: 'Precision', functionMode: 'Function · lower overhead', blockMode: 'Block · more precise', startNow: 'Start now', startReload: 'Start and reload', toolLoading: 'Updating code coverage', toolAttention: 'Code coverage needs attention', toolRecording: 'Recording {mode} coverage', toolComplete: '{percent} code used', toolDescription: 'Find unused JavaScript and CSS', toolAria: 'Code coverage: {status}',
    caveats: { observed: 'Coverage includes only code observed after recording started; exercise the relevant page paths before stopping.', precision: 'Function mode has lower overhead; block mode is more precise but can slow JavaScript execution.', evidence: 'Unused bytes in one recording are optimization evidence, not proof that code is unused for every user or route.' }
  },
  cpuProfile: {
    kicker: 'Runtime diagnostics', heading: 'JavaScript CPU profile', close: 'Close JavaScript CPU profile', loading: 'Updating JavaScript CPU profile…', privacy: 'Only bounded function timing and sanitized locations leave the profiler.', failed: 'JavaScript CPU profile needs attention', tryAgain: 'Try again', recording: 'CPU activity is recording', recordingDescription: 'Exercise the slow interaction once, then stop to rank functions by direct self time.', started: 'Started {time}', stop: 'Stop and show hotspots', profileTime: 'Profile time', sampleCount: '{count} sample | {count} samples', sampledTime: 'Sampled time', selfTime: 'JavaScript self time', hotFunctions: 'Hot functions', bounded: 'Top bounded results', ranked: 'Ranked by self time', hotspotsAria: 'JavaScript CPU hotspots', anonymous: 'Browser or anonymous runtime work', hotspotDetails: '{duration} self · {samples}', noHotspot: 'No JavaScript hotspot was sampled', noHotspotDescription: 'Record a longer or CPU-heavy interaction and try again.', interpretation: 'How to interpret this profile', startedOn: 'Started on {url}', pageChanged: '· page changed', clear: 'Clear', recordAgain: 'Record again', emptyHeading: 'Find hot JavaScript functions', emptyDescription: 'Start recording, reproduce one slow interaction, then stop. Hronaut reports sampled self time without source code or page content.', start: 'Start recording', toolLoading: 'Updating JavaScript CPU profile', toolAttention: 'JavaScript CPU profile needs attention', toolRecording: 'Recording JavaScript CPU activity', toolHotspot: '{function}: {percent} self time', toolComplete: 'CPU profile complete', toolDescription: 'Find hot JavaScript functions', toolAria: 'JavaScript CPU profile: {status}',
    caveats: { sampled: 'The profile contains sampled JavaScript self time, so short functions and browser rendering work may not appear.', repeat: 'Record the smallest reproducible interaction and compare repeated runs before changing production code.', excluded: 'Function names and sanitized locations are included, but source code, arguments, and page content are never returned.' }
  },
  memory: {
    kicker: 'Local diagnostics', heading: 'Page memory', close: 'Close memory report', loading: 'Collecting local memory counters…', privacy: 'The measurement stays in Hronaut and never includes page content.', failed: 'Memory report could not finish', tryAgain: 'Try again', heapUsed: 'JS heap used', fromBaseline: '{value} from baseline', noBaselineYet: 'No baseline yet', domNodes: 'DOM nodes', eventListeners: 'Event listeners', documents: 'Documents', heapCapacity: 'Heap capacity', embedderHeap: 'Embedder heap', backingStorage: 'Backing storage', layoutObjects: 'Layout objects', frames: 'Frames', sample: 'Sample', afterForcedGc: 'After forced GC', currentState: 'Current state', leakHint: 'Growth is a clue, not proof of a leak. Repeat the same interaction and compare post-GC samples.', baselineCleared: 'Baseline cleared', baselineClearedDescription: 'Set a new baseline before reproducing the interaction you want to inspect.', baselineActive: 'Runtime baseline active', noBaseline: 'No baseline', clear: 'Clear', setBaseline: 'Set baseline', gcMeasure: 'GC & measure', toolMeasuring: 'Measuring page memory', toolAttention: 'Memory report needs attention', toolSampling: 'Sampling live JavaScript allocations', toolHotspot: '{function}: {bytes} retained', toolAllocationComplete: 'Allocation profile complete', toolClose: 'Close page memory report', toolDescription: 'Heap, DOM, and allocation diagnostics', toolAria: 'Page memory: {status}',
    allocation: { kicker: 'JavaScript allocation sampling', heading: 'Find retained allocations by function', clear: 'Clear profile', recording: 'Allocation sampling is recording', recordingDescription: 'Repeat the memory-heavy interaction, then stop to rank functions by sampled live bytes.', started: 'Started {time}', stop: 'Stop and show allocations', sampledBytes: 'Sampled live bytes', sampleCount: '{count} sample | {count} samples', hotFunctions: 'Hot functions', bounded: 'Top bounded results', ranked: 'Ranked by retained bytes', topLocation: 'Top location', ofSampledBytes: 'of sampled live bytes', hotspotsAria: 'JavaScript allocation hotspots', anonymous: 'Browser or anonymous runtime allocation', hotspotDetails: '{bytes} sampled live · {samples}', noHotspot: 'No retained allocation hotspot was sampled', noHotspotDescription: 'Record a longer memory-heavy interaction and try again.', interpretation: 'How to interpret allocation sampling', recordAgain: 'Record again', emptyHeading: 'Locate functions retaining JavaScript memory', emptyDescription: 'Start sampling, reproduce one interaction, then stop. Object values and page content never leave the profiler.', start: 'Start sampling', caveats: { sampled: 'Allocation sampling reports a bounded statistical view of live JavaScript allocations, not every allocated object.', retained: 'A sampled live allocation is retained at collection time but is not by itself proof of a memory leak.', evidence: 'Function names and sanitized locations are included, while object values, source code, and page content are excluded.' } }
  },
  console: {
    kicker: 'Current website', heading: 'Console', close: 'Close Console', filterAria: 'Filter Console messages', filterPlaceholder: 'Filter messages or sources', level: 'Level', levelAria: 'Filter Console by level', allLevels: 'All levels', errors: 'Errors ({count})', warnings: 'Warnings ({count})', info: 'Info ({count})', verbose: 'Verbose ({count})', preserveTitle: 'Keep bounded Console and Network evidence when this tab loads another page', preserve: 'Preserve logs', reading: 'Reading the bounded Console log…', logAria: 'Sanitized Console messages', repeatedEvents: '{count} repeated Console events', repeatedSince: 'Repeated since {time}', handledLater: 'handled later', copyEntry: 'Copy Console entry', copied: 'Copied', copy: 'Copy', callStack: 'Call stack', async: 'async', anonymous: '(anonymous)', truncatedStack: 'Only the first 20 sanitized frames are shown.', noMatches: 'No messages match these filters', noMessages: 'No Console messages captured yet', changeFilter: 'Change the text or level filter.', useWebsite: 'Use the website or reload it; new messages appear automatically.', summary: '{visible} of {total} entries · {visibleEvents} of {totalEvents} events · newest first · sanitized', clear: 'Clear', refresh: 'Refresh', copiedAll: 'Copied all', copyAll: 'Copy all', copiedFiltered: 'Copied filtered', copyFiltered: 'Copy filtered', levels: { error: 'error', warning: 'warning', info: 'info', verbose: 'verbose' }
  },
  network: {
    kicker: 'Current website', heading: 'Network', close: 'Close network monitor', searchContent: 'Search request content', searchContentTitle: 'Search headers, payloads, and responses', refreshRequests: 'Refresh network requests', refresh: 'Refresh', filterAria: 'Filter network requests', filterPlaceholder: 'Filter requests · method:POST status-code:500', filterTitle: 'Combine free text with domain:, is:running, larger-than:, method:, resource-type:, scheme:, status-code:, or url: filters', sort: 'Sort', sortAria: 'Sort network requests', sortDirection: 'Sort network requests {direction}', ascending: 'ascending', descending: 'descending', ascendingTitle: 'Ascending', descendingTitle: 'Descending', failuresOnly: 'Failures only', preserveTitle: 'Keep bounded Network and Console evidence when this tab loads another page', preserve: 'Preserve logs', resourceFilterAria: 'Filter requests by resource type', reading: 'Reading the bounded request log…', requestsAria: 'Network requests', noMatches: 'No requests match these filters', noRequests: 'No requests captured yet', changeFilters: 'Change the text, type, or failure filter.', useWebsite: 'Use the website, then refresh this monitor.', detailsLoading: 'Reading request details…', selectRequest: 'Select a request', selectDescription: 'Inspect bounded, sanitized request and response details.', summary: '{visible} of {total} requests · {bytes} captured', clear: 'Clear', copied: 'Copied', copyHar: 'Copy sanitized HAR', saving: 'Saving…', saved: 'Saved', saveHar: 'Save sanitized HAR', noStatus: 'No status', matchCount: '{count} match | {count} matches', filters: { all: 'All', fetchXhr: 'Fetch/XHR', document: 'Doc', image: 'Img', other: 'Other' }, sorts: { start: 'Start time', end: 'End time', duration: 'Duration', waiting: 'Waiting (TTFB)', size: 'Size', status: 'Status' },
    conditions: { heading: 'Request conditions', description: 'Block, mock, throttle, and prioritize requests', active: '{count} active', reading: 'Reading temporary conditions…', listAria: 'Active request conditions', firstWins: 'First matching condition wins', priority: 'Priority {number}', anyMethod: 'Any method', failAs: 'Fail as {reason}', respond: 'Respond {status} · {bytes} B body', throttleAs: 'Throttle as {profile}', matchesLeft: '{count} match left | {count} matches left', untilRemoved: '· until removed', moveUpAria: 'Move request condition {pattern} up', moveDownAria: 'Move request condition {pattern} down', removeAria: 'Remove request condition {pattern}', moveUp: 'Move up', moveDown: 'Move down', remove: 'Remove condition', empty: 'No request conditions', emptyDescription: 'Add one to test loading and API failure states.', formAria: 'Add temporary request condition', addHeading: 'Add temporary condition', urlPattern: 'URL pattern', method: 'Method', any: 'Any', behavior: 'Behavior', block: 'Block / fail', mock: 'Mock response', throttle: 'Throttle request', matches: 'Matches', networkProfile: 'Network profile', fast4g: 'Fast 4G', slow4g: 'Slow 4G', slow3g: 'Slow 3G', failureReason: 'Failure reason', httpStatus: 'HTTP status', responseHeaders: 'Response headers', jsonValues: 'JSON object with string values', responseBody: 'Response body', maxBody: 'up to 512 KiB', safety: 'First match wins. Block and mock rules expire after their match count; throttles stay active until removed. Every condition is discarded when the tab or Hronaut closes.', adding: 'Adding…', add: 'Add condition', secretNote: 'Mock bodies and header values are never shown again after creation.', removeAll: 'Remove all' },
    contentSearch: { aria: 'Search headers, payloads, responses, WebSocket text, and event streams', matchCase: 'Match case', searching: 'Searching…', search: 'Search', close: 'Close request content search', result: '{fields} in {requests}', fieldCount: '{count} matching field | {count} matching fields', requestCount: '{count} request | {count} requests', searched: '{searched} of {available} requests searched', bounded: '· bounded', inspect: 'Inspect matching request {number}: {label}', occurrenceCount: '{count} matches', empty: 'No sanitized request content matched “{query}”.', safety: 'Known secret fields, binary bodies, and multipart bodies are omitted. Review arbitrary text before sharing.' },
    details: { responseSource: 'Response source', workerResponse: 'Worker response', cacheName: 'Cache Storage name', directNetwork: 'Chromium reported a direct network response.', evidence: 'Sanitized current-request evidence', reviewCommands: '· review commands before sharing or running', replayRisk: 'This method can repeat writes or other side effects and requires a second click.', replaySafe: 'Replay this XHR with its original request details inside Chromium.', confirmReplay: 'Confirm replay {method}', replaying: 'Replaying…', replayed: 'Replayed XHR', replay: 'Replay XHR', copiedJson: 'Copied JSON', copyJson: 'Copy JSON', copiedCurl: 'Copied cURL', copyCurl: 'Copy sanitized cURL', copiedFetch: 'Copied fetch', copyFetch: 'Copy sanitized fetch', initiator: 'Initiator', redirectedFrom: 'Redirected from', source: 'Source', anonymous: '(anonymous)', truncatedStack: 'Only the first 12 sanitized frames are shown.', initiatorUnavailable: 'Chromium identified the initiator type without exposing a source location.', relationships: 'Request relationships', relatedCount: '{count} related', triggeredBy: 'Triggered by', reportedByChromium: 'Reported by Chromium', inspectTrigger: 'Inspect triggering request {request}', redirectChain: 'Redirect chain', retainedHops: '{count} retained hops', currentRequest: 'Current request', inspectCurrent: 'Current request {request}', inspectRedirect: 'Inspect redirect hop {number} {request}', triggeredRequests: 'Triggered requests', directCount: '{count} direct', inspectTriggered: 'Inspect triggered request {request}', boundedRelationships: 'Only a bounded window of retained relationships is shown.', messages: 'Messages', olderCount: '+ {count} older', connectionOpen: 'Connection open', connectionClosed: 'Connection closed', socketSafety: 'Text is sanitized; binary payloads are omitted.', payloadOmitted: 'Payload omitted for {kind}', opcode: '(opcode {opcode})', noMessages: 'No messages captured yet.', olderMessages: '{count} older message was removed from the bounded diagnostic buffer. | {count} older messages were removed from the bounded diagnostic buffer.', eventStream: 'Event stream', streamOpen: 'Stream open', streamClosed: 'Stream closed', eventSafety: 'Event names, IDs, and data are sanitized and bounded.', event: 'event', eventId: 'Event ID: {id}', emptyEvent: 'Empty event data.', truncated: 'truncated', sanitized: 'sanitized', noEvents: 'No events captured yet.', olderEvents: '{count} older event was removed from the bounded diagnostic buffer. | {count} older events were removed from the bounded diagnostic buffer.', timing: 'Timing', serverMetrics: '{count} server metric | {count} server metrics', overlap: 'Connection setup sub-phases overlap “Before request sent” and are not added to the total twice.', serverTiming: 'Server timing', reportedByResponse: 'Reported by the response', noDuration: 'No duration', serverCaveat: 'Server-defined metrics can overlap and do not need to add up to TTFB.', requestHeaders: 'Request headers', noRequestHeaders: 'No request headers captured.', requestBody: 'Request body', responseHeaders: 'Response headers', noResponseHeaders: 'No response headers captured.', responseBody: 'Response body', safety: 'Security headers, credential fields, fragments, binary bodies, and multipart bodies are protected.', inlineScript: 'inline script', sourceUnavailable: 'Source unavailable', timingUnavailable: 'Relative request timing unavailable', firstRequest: 'Started with the first visible request', startedAfter: 'Started {duration} after the first visible request', pending: 'still pending', total: '{duration} total', waitingResponse: '{duration} waiting for the response', timingRows: { total: 'Total', setup: 'Before request sent', proxy: 'Proxy negotiation', dns: 'DNS lookup', connection: 'Initial connection', tls: 'TLS handshake', serviceWorker: 'Service worker preparation', sent: 'Request sent', waiting: 'Waiting (TTFB)', headers: 'Response headers', download: 'Content download' } }
  },
  issues: { kicker: 'Chromium diagnostics', heading: 'Issues', close: 'Close browser issues', loading: 'Checking browser-detected issues…', privacy: 'Cookie values and raw browser payloads stay protected.', failed: 'Issues could not be loaded', tryAgain: 'Try again', pageErrors: 'page errors', warnings: 'warnings', improvements: 'improvements', empty: 'No browser issues captured', emptyDescription: 'Reload and reproduce the problem to include diagnostics emitted during page startup.', affected: 'Affected resources', truncated: 'Showing the newest 200 issues.', sharing: 'Sharing and scope', count: '{count} issue | {count} issues', review: '· review before sharing', clear: 'Clear', refresh: 'Refresh', copied: 'Copied', copy: 'Copy issues', toolCount: '{count} browser issue | {count} browser issues', toolDescription: 'CORS, CSP, cookies, and compatibility', toolAria: 'Open browser issues: {status}', caveats: { scope: 'Issues are browser-generated diagnostics for the current document, not a complete quality audit.', privacy: 'URLs are bounded and redact credentials, fragments, and security-related query values; cookie values and raw issue payloads are never returned.', devtools: 'Developer Tools currently owns diagnostics for this tab; close it and reload to collect new issues in Hronaut.', reload: 'Reload the page before reproducing a problem when you need issues emitted during startup.' } },
  debugReport: { kicker: 'Console & network', heading: 'Debug report', close: 'Close debug report', loading: 'Collecting bounded debug evidence…', privacy: 'Request bodies and headers are not included in this report.', failed: 'Debug report could not finish', tryAgain: 'Try again', consoleErrors: 'console errors', warnings: 'warnings', failedRequests: 'failed requests', requestsSeen: 'requests seen', empty: 'No console messages or failed requests captured', emptyDescription: 'Reproduce the issue, then refresh this report. Successful-request totals still appear above.', recentConsole: 'Recent console', failedRequestsHeading: 'Failed requests', sharing: 'Sharing and scope', generated: 'Generated {time} · review before sharing', preserveTitle: 'Keep bounded Network and Console evidence when this tab loads another page', preserve: 'Preserve logs across page loads', refresh: 'Refresh', copied: 'Copied', copy: 'Copy report', toolCollecting: 'Collecting debug evidence', toolAttention: 'Debug report needs attention', toolSignals: 'Debug report: {count} signal | Debug report: {count} signals', toolClear: 'Debug report: no obvious issues', toolDescription: 'Create debug report', caveats: { network: 'Network entries contain metadata only. URLs redact credentials, fragments, and security-related query values; headers and bodies are excluded.', console: 'Console messages are page-authored. Hronaut applies bounded best-effort secret filtering, but review arbitrary text before sharing it outside your trusted agent session.', repeats: 'Adjacent identical ordinary Console messages may be stored once with repeatCount; uncaught exceptions remain separate occurrences.', failures: 'The network list includes failed requests only; summary counts still cover the bounded in-memory network history.' } },
  repro: { kicker: 'Privacy-safe timeline', heading: 'Repro recorder', close: 'Close repro recorder', loading: 'Loading reproduction steps…', failed: 'Repro recorder needs attention', tryAgain: 'Try again', recording: 'Recording accepted human actions', stopped: 'Recording stopped', ready: 'Ready to record', privacy: 'Typed values, clipboard contents, uploads, screenshots, and page HTML are never recorded.', showIssue: 'Show the issue once', emptyDescription: 'Start recording, reproduce the problem in this tab, then stop and copy a compact timeline into agent chat.', start: 'Start recording', timelineAria: 'Recorded reproduction steps', truncated: 'Timeline reached its 200-step limit.', privacyScope: 'Privacy and scope', stepCount: '{count} step | {count} steps', review: '· review before sharing', clear: 'Clear', stop: 'Stop', recordAgain: 'Record again', copied: 'Copied', copyTimeline: 'Copy timeline', copiedPlaywright: 'Copied Playwright', copyPlaywright: 'Copy Playwright', toolRecording: 'Recording · {steps}', toolReady: '{steps} ready to share', toolDescription: 'Record safe steps for an agent', toolAria: 'Repro recorder: {status}', caveats: { values: 'Typed values, clipboard contents, uploaded file paths, screenshots, and page HTML are never recorded.', selectors: 'Selectors use only structural tag positions and can require adjustment after the page changes.', scope: 'The recorder captures accepted human input and top-level navigation in this tab; MCP tool actions are not duplicated in the timeline.', bounded: 'The timeline keeps at most 200 steps in memory and is discarded when the tab or Hronaut closes.' } },
  domChanges: { kicker: 'Structural evidence', heading: 'DOM changes', close: 'Close DOM changes', loading: 'Loading DOM changes…', failed: 'DOM changes need attention', tryAgain: 'Try again', recording: 'Recording structural page changes', stopped: 'Recording stopped', ready: 'Ready to record', privacy: 'Text, HTML, attribute values, IDs, classes, and form values are never recorded.', reveal: 'Reveal what an action changed', emptyDescription: 'Start recording, interact with the live page, then stop and copy the bounded structural report into agent chat.', start: 'Start recording', waiting: 'Waiting for a page change', noChanges: 'No structural changes recorded', waitingDescription: 'Use the website beside this panel; changes will appear here automatically.', retryDescription: 'Record again and perform the interaction whose result is unclear.', timelineAria: 'Recorded DOM changes', addedTags: 'Added tags: {tags}', removedTags: 'Removed tags: {tags}', truncated: 'The 200-entry limit was reached; {count} later changes were counted but omitted.', privacyScope: 'Privacy and scope', mutations: '{count} mutation | {count} mutations', entries: '{count} grouped entry | {count} grouped entries', clear: 'Clear', stop: 'Stop', recordAgain: 'Record again', copied: 'Copied', copy: 'Copy report', toolRecording: 'Recording · {changes}', toolReady: '{changes} ready to share', toolDescription: 'See what changed after an action', toolAria: 'DOM changes: {status}', change: { attribute: '{attribute} changed', attributeRepeated: '{attribute} changed {count} times', text: 'Text content changed (content not recorded)', textRepeated: 'Text content changed {count} times (content not recorded)', added: '{count} added', removed: '{count} removed', child: 'Child structure changed' }, caveats: { structural: 'Only structural selectors, mutation types, attribute names, tag names, and counts are recorded.', values: 'Page text, HTML, attribute values, IDs, classes, form values, clipboard content, and file paths are never recorded.', frames: 'Cross-origin frames and changes inside existing shadow roots are not observed.', navigation: 'A full document navigation clears the recording because it creates a new DOM.' } },
  visualCompare: { kicker: 'Before and after', heading: 'Visual compare', close: 'Close visual compare', loading: 'Capturing the visible page…', failed: 'Visual comparison needs attention', returnBaseline: 'Return to baseline', empty: 'Capture the page before a change', emptyDescription: 'Hronaut keeps one temporary viewport baseline for this tab. Make the change, then compare the current page.', setBaseline: 'Set baseline', baselineReady: 'Baseline ready', identical: 'No changed pixels', changed: '{percent} of pixels changed', diffAlt: 'Visual difference: changed pixels are white and unchanged pixels are dimmed', changedPixels: 'Changed pixels', totalPixels: 'Total pixels', threshold: 'Threshold', changedArea: 'Changed area', none: 'None', accuracy: 'Accuracy and privacy', storage: 'Viewport-only · stored in memory', clear: 'Clear', newBaseline: 'New baseline', compare: 'Compare now', copied: 'Copied', copy: 'Copy diff PNG', toolCapturing: 'Capturing visible page', toolAttention: 'Visual comparison needs attention', toolIdentical: 'No changed pixels', toolChanged: '{percent} changed', toolBaseline: 'Baseline ready', toolDescription: 'Compare the page before and after', toolAria: 'Visual compare: {status}', caveats: { viewport: 'The baseline, current capture, and diff cover the visible viewport only and are normalized to at most 1920 × 1080 pixels.', threshold: 'A pixel is marked changed when any native bitmap channel differs by more than {threshold}; animations, caret blinking, video, and delayed content can create noise.', environment: 'Generate the baseline and comparison in the same Hronaut environment; browser, operating-system, font, and GPU differences can change rendering.', memory: 'Baseline and diff images stay only in memory and are discarded when cleared, when the tab closes, or when Hronaut exits.', navigation: 'The page URL changed after the baseline; this is a cross-navigation comparison.' } },
  tabSearch: { kicker: 'Browser workspace', heading: 'Tabs', results: 'Tab overview results', ungrouped: 'Other tabs', previewSleeping: 'Sleeping — open to preview', previewUnavailable: 'Preview unavailable', countOpen: '{count} open', countSaved: '· {count} saved', countClosed: '· {count} closed', close: 'Close tab search', search: 'Search tabs', placeholder: 'Search titles and addresses', matches: '{count} matching item. | {count} matching items.', selected: 'Selected {item}.', empty: 'No website tabs open', homeAvailable: 'Home stays available as application navigation.', newTab: 'Open a new tab', noMatches: 'No matching tabs', tryAnother: 'Try another title or address.', archived: 'Archived workspaces', archivedAria: 'Archived workspaces', savedTabs: '{count} saved tab | {count} saved tabs', restoreWorkspaceAria: 'Restore archived workspace {name}', restoreWorkspace: 'Restore workspace', deleteWorkspaceAria: 'Delete archived workspace {name}', deleteWorkspace: 'Delete archived workspace', openTabs: 'Open tabs', newTabTitle: 'New tab', blankPage: 'Blank page', pinAria: 'Pin {title}', unpinAria: 'Unpin {title}', pin: 'Pin tab', unpin: 'Unpin tab', closeTabAria: 'Close {title}', closeTab: 'Close tab', recentlyClosed: 'Recently closed', restoreAria: 'Restore {title}', restore: 'Restore tab', navigate: 'Navigate', open: 'Open', meta: { group: 'Group: {name}', pinned: 'Pinned', current: 'Current tab', locked: 'Interaction locked', muted: 'Muted', audio: 'Playing audio', agent: 'Agent active', emulated: 'Emulated: {state}', routes: '{count} temporary network route | {count} temporary network routes', justNow: 'Closed just now', minutesAgo: 'Closed {count} min ago', closedAt: 'Closed {time}' } },
  find: { region: 'Find in page', text: 'Find text', placeholder: 'Find in page', previousTitle: 'Previous match (Shift+Enter)', previous: 'Previous match', nextTitle: 'Next match (Enter)', next: 'Next match', closeTitle: 'Close (Escape)', close: 'Close find in page' },
  zoom: { controls: 'Page zoom controls', heading: 'Page zoom', outTitle: 'Zoom out (Ctrl/Cmd+-)', out: 'Zoom out', inTitle: 'Zoom in (Ctrl/Cmd++)', in: 'Zoom in', reset: 'Reset', closeTitle: 'Close (Escape)', close: 'Close page zoom controls' },
  downloads: { kicker: 'Browser files', heading: 'Downloads', clearFinished: 'Clear finished', close: 'Close downloads', empty: 'No downloads yet', emptyDescription: 'Files you download will appear here.', downloading: 'Downloading {filename}', cancelAria: 'Cancel {filename}', cancel: 'Cancel download', showAria: 'Show {filename} in folder', show: 'Show in folder', received: '{received} of {total}', downloaded: '{received} downloaded', complete: '{size} · Complete', cancelled: 'Cancelled', interrupted: 'Interrupted' },
  bookmarks: { kicker: 'Saved locally', heading: 'Bookmarks', removeCurrent: 'Remove current', addCurrent: 'Add current', close: 'Close bookmarks', search: 'Search bookmarks', empty: 'No bookmarks yet', emptyDescription: 'Save the current website with Ctrl/Cmd+D.', noMatches: 'No matching bookmarks', tryAnother: 'Try another title or address.', renameAria: 'Rename {title}', saveAria: 'Save name for {title}', save: 'Save name', rename: 'Rename bookmark', removeAria: 'Remove {title}', remove: 'Remove bookmark' },
  history: { kicker: 'Saved locally', heading: 'Browsing history', clearAll: 'Clear all', close: 'Close browsing history', search: 'Search browsing history', placeholder: 'Search history', empty: 'No browsing history yet', emptyDescription: 'Websites you visit will appear here for up to 90 days.', noMatches: 'No matching visits', tryAnother: 'Try another title or address.', removeAria: 'Remove {title} from history', remove: 'Remove from history', retention: 'Stored only on this device for up to 90 days.', visits: '{count} visits' },
  siteStorage: { kicker: 'Current website', heading: 'Site storage · {host}', close: 'Close site storage', refresh: 'Refresh', typeAria: 'Storage type', overview: 'Overview', local: 'Local', session: 'Session', cookies: 'Cookies', offline: 'Offline', changes: 'Changes', measuring: 'Measuring storage usage…', overviewAttention: 'Storage overview needs attention', used: 'Used', available: 'Available', quota: 'Quota', quotaUsed: '{percent} of origin quota used', usedPercent: '{percent} used', chromiumQuota: 'Chromium quota detail', storageEstimate: 'Storage Manager estimate', override: 'Quota override active', copied: 'Copied', copyReport: 'Copy report', noBreakdown: 'No category breakdown available', noBreakdownDescription: 'The total estimate is still available above.', scopePrivacy: 'Scope and privacy', aggregate: 'Read-only aggregate metadata', filter: 'Filter site storage', filterPlaceholder: 'Filter keys or values', clearKind: 'Clear {kind}', key: 'Storage key', keyPlaceholder: 'Key', value: 'Storage value', valuePlaceholder: 'Value', update: 'Update', add: 'Add', reading: 'Reading site storage…', noKind: 'No {kind}', noKindDescription: 'This website has not stored anything in this category.', noMatches: 'No matching entries', protectedTitle: 'HttpOnly cookie value is protected', editTitle: 'Edit this entry', protectedValue: 'HttpOnly value protected', emptyValue: '(empty)', previewTruncated: '· preview truncated', protectedAria: '{key} is HttpOnly and protected', deleteAria: 'Delete {key}', protectedCookie: 'HttpOnly cookie is protected', deleteEntry: 'Delete entry', entries: '{count} entry | {count} entries', thisTab: 'This tab only', sharedOrigin: 'Shared by origin in this workspace',
    indexed: { reading: 'Reading IndexedDB…', attention: 'IndexedDB inspection needs attention', empty: 'No IndexedDB databases', emptyDescription: 'This website has not created a database for its top-level origin.', database: 'Database', databaseAria: 'IndexedDB database', objectStore: 'Object store', objectStoreAria: 'IndexedDB object store', records: '{count} record | {count} records', filter: 'Filter IndexedDB records', filterPlaceholder: 'Filter loaded keys or values', copyLoaded: 'Copy loaded', keyPath: 'Key path', autoIncrement: 'Auto increment', manualKeys: 'Manual keys', indexes: '{count} indexes', noStores: 'No object stores', noRecords: 'No records in this object store', noMatches: 'No matching loaded records', omitted: 'Value omitted', primaryKey: 'Primary key {key}', preview: '· {size} preview', truncated: '· truncated', schema: 'Schema, indexes, and privacy', unique: '(unique)', noIndexes: 'No indexes', range: 'Records {start}–{end}', previous: 'Previous', next: 'Next' },
    pwa: { reading: 'Reading offline app state…', attention: 'Offline inspection needs attention', controlled: 'Page controlled by a service worker', uncontrolled: 'Page is not controlled', registrations: '{count} registration | {count} registrations', caches: '{count} cache | {count} caches', manifestUnavailable: 'Web app manifest unavailable: {error}', manifest: 'Web app manifest', embedded: 'Embedded manifest', startUrl: 'Start URL', scope: 'Scope', assets: 'Assets', icons: '{count} icons', shortcuts: '{count} shortcuts', findings: 'Manifest and installability findings', line: '· line {line}', noInstallErrors: 'No installability errors reported by this Chromium build.', installUnavailable: 'Installability diagnostics are unavailable in this Chromium build.', noManifest: 'No web app manifest detected', noWorkerScript: 'No worker script', inactive: 'inactive', updateViaCache: 'update via cache: {value}', noRegistrations: 'No service-worker registrations', cacheUnavailable: 'Cache Storage unavailable: {error}', cache: 'Cache', cacheAria: 'Cache Storage cache', filter: 'Filter cached requests', filterPlaceholder: 'Filter request paths', apply: 'Apply', noMatching: 'No matching cached requests', noCaches: 'No Cache Storage caches', matching: '{count} matching entry | {count} matching entries' },
    trackedChanges: { reading: 'Reading storage baseline…', attention: 'Storage comparison needs attention', empty: 'See what browser state changes', emptyDescription: 'Set a baseline, perform the action on the website, then compare local storage, session storage, and cookies.', setBaseline: 'Set baseline', baselineReady: 'Baseline ready', noChanges: 'No storage changes', changeCount: '{count} storage change | {count} storage changes', useThenCompare: 'Use the website, then compare.', counts: '{added} added · {updated} updated · {removed} removed', httpOnly: '· HttpOnly', attributesChanged: '· attributes changed', truncated: 'The bounded snapshot or 200-change report limit was reached.', baseline: 'Baseline {time}', notSet: 'not set', clear: 'Clear', newBaseline: 'New baseline', copy: 'Copy report', compare: 'Compare now' }
  },
  updates: {
    status: {
      checking: 'Checking for updates',
      available: 'Hronaut {version} is available',
      downloading: 'Downloading update',
      downloaded: 'Update ready to install',
      installing: 'Installing update',
      current: 'Hronaut is up to date',
      attention: 'Update needs attention',
      unavailable: 'Updates unavailable',
      default: 'Software updates'
    },
    description: {
      checking: 'Looking for a newer Hronaut release…',
      available: 'Hronaut {version} is ready to download.',
      downloading: 'Downloading Hronaut {version}…',
      downloaded: 'Hronaut {version} will restart after installation.',
      installing: 'Hronaut will restart automatically when installation finishes.',
      current: 'You are using the latest version ({version}).',
      failed: 'The update could not be completed.',
      unavailable: 'Updates are unavailable for this build.',
      version: 'Current version: {version}'
    },
    pill: {
      available: 'Version {version} available',
      downloading: 'Downloading {percent}%',
      downloaded: 'Restart to update',
      installing: 'Installing update',
      current: 'Hronaut is up to date',
      attention: 'Update needs attention',
      unavailable: 'Updates unavailable',
      checking: 'Checking for updates'
    },
    open: 'Open software updates: {status}',
    openTitle: 'Open Software updates',
    cardLabel: 'Software update status',
    progress: 'Download progress',
    releaseNotes: 'Release notes',
    download: 'Download update',
    install: 'Install and restart',
    retryInstall: 'Try installation again',
    history: {
      kicker: 'GitHub releases', title: "What's new", close: "Close What's new", refresh: 'Refresh release history',
      loading: 'Loading release history…', loadingDescription: 'Reading the canonical Hronaut releases from GitHub.',
      unavailable: 'Release history is unavailable', empty: 'No published releases', emptyDescription: 'Published Hronaut releases will appear here.',
      noNotes: 'No release notes were published for this version.', source: 'Source of truth: GitHub Releases',
      loadMore: 'Load older releases', loadingMore: 'Loading…', openAll: 'View all on GitHub',
      openRelease: 'Open Hronaut {version} on GitHub', view: "View what's new"
    }
  },
  addressOverlay: {
    label: 'Local address suggestions',
    bookmark: 'Bookmark',
    history: 'History',
    historyVisits: 'History · {count} visits',
    localOnly: 'Local only'
  },
  panelDocks: { responsive: 'Dock responsive preview', network: 'Dock network monitor', issues: 'Dock browser issues' },
  accessibility: { recentlyClosedTabs: 'Recently closed tabs' },
  home: {
    title: 'Hronaut Home',
    brand: 'Hronaut home',
    hero: 'Your browser, ready for coding agents.',
    lead: 'Keep one visible browser session open, share its cookies and storage across tabs, and let any MCP-compatible coding agent navigate it with you.',
    status: {
      starting: 'MCP server starting', online: 'MCP server online', paused: 'Agents paused', error: 'MCP server error',
      pausedValue: 'Paused', unavailable: 'Unavailable', startingValue: 'Starting', activeOne: '{count} active', activeOther: '{count} active',
      unknownError: 'Unknown startup error', waiting: 'Waiting for the first tool call', reconnecting: 'Reconnecting to local status'
    },
    endpoint: 'Streamable HTTP',
    copyUrl: 'Copy URL',
    connect: {
      heading: 'Connect your coding agent',
      description: 'Choose a client, copy the setup, then create a named workspace before browsing.',
      clients: '16 clients',
      agentsLabel: 'Coding agents',
      instructions: 'Setup instructions',
      copy: 'Copy',
      beforeLaunch: 'Before launching client',
      verify: 'Verify connection',
      openGuide: 'Open full {name} guide ↗',
      guideUnavailable: 'The setup guide for this client is unavailable.',
      openVsCode: 'Open in VS Code',
      openingVsCode: 'Opening VS Code…',
      vscodeOpened: 'VS Code opened. Confirm the Hronaut MCP server there.',
      vscodeFailed: 'Could not open VS Code. Use the manual setup below.',
      vscodeUnavailable: 'The VS Code setup bridge is unavailable.',
      guides: {
        codex: 'Adds Hronaut to your user-level Codex configuration.',
        claudeCode: 'Uses the recommended Streamable HTTP transport for every project.',
        cursor: 'Save globally, or move the same object to .cursor/mcp.json for one project.',
        vscode: 'Save in the workspace, or use MCP: Open User Configuration for global access.',
        opencode: 'Adds Hronaut as a remote Streamable HTTP server in OpenCode.',
        geminiCli: 'Adds Hronaut as a user-scoped Streamable HTTP server in Gemini CLI.',
        cline: 'Adds Hronaut to Cline with its recommended Streamable HTTP transport.',
        kiro: 'Adds Hronaut to Kiro at user scope with tool auto-approval kept disabled.',
        kilo: 'Adds Hronaut as a remote Streamable HTTP server shared by Kilo Code surfaces.',
        jetbrainsJunie: 'Adds Hronaut to the user-level MCP configuration shared by Junie CLI and JetBrains IDEs.',
        devinLocal: 'Adds Hronaut to the user-level configuration used by Devin Local and new Devin Desktop tabs.',
        zed: 'Adds Hronaut as a custom remote server for Zed Agent and ACP-forwarded external agents.',
        mistralVibe: 'Adds Hronaut to the configuration shared by local Vibe CLI and VS Code sessions.',
        warp: 'Adds Hronaut as a user-level URL server for Warp\'s local Agent.',
        windsurf: 'Adds Hronaut to Windsurf Cascade through its user-level Streamable HTTP configuration.',
        generic: 'Use Streamable HTTP and point the client directly at Hronaut.',
        genericLocation: 'Client MCP settings'
      }
    },
    security: {
      disabled: 'Warning: MCP authentication is disabled for this launch. Any process on this computer can control this browser profile.',
      tokenFile: 'Authentication is required. Hronaut generated an owner-only token at {path}. The token is never displayed on this page.',
      tokenEnvironment: 'Authentication is required. Use the HRONAUT_MCP_TOKEN value supplied when Hronaut was launched.'
    },
    connections: {
      heading: 'Connections', description: 'Active requests and recently seen MCP clients.',
      emptyHeading: 'No clients connected yet', emptyDescription: 'Copy a setup snippet, refresh your coding agent, and its activity will appear here.',
      versionUnknown: 'Version not reported', active: 'Active', recent: 'Recent'
    },
    firstRun: {
      kicker: 'First success',
      heading: 'Try Hronaut with one safe task',
      description: 'After connecting, copy this prompt into your coding agent. You will see it create an isolated workspace and inspect a page without using Default.',
      prompt: 'Using Hronaut, create a new isolated workspace named “Hronaut first run”, open https://example.com, take a semantic snapshot, and tell me the page heading. Do not use the Default workspace.',
      copy: 'Copy prompt'
    },
    activity: {
      heading: 'Agent activity', description: 'A local, content-free view of what Hronaut handled during this launch.',
      tabActionsCompleted: 'Tab actions completed', toolsUsed: 'Tools used', successfulActions: 'Successful actions', recent: 'Recent activity',
      privacy: 'Hronaut records only tool names, timing, and outcome in memory. URLs, selectors, typed text, screenshots, and page content are not stored here.',
      emptyHeading: 'No tab actions yet', emptyDescription: 'Tool calls will appear here after an agent starts working.',
      failed: 'Failed', done: 'Done'
    },
    support: {
      kicker: 'Get connected', activeKicker: 'Share Hronaut', heading: 'Connect and verify Hronaut.', failedHeading: 'The first action needs attention.',
      activeHeadingOne: 'Hronaut completed {count} tab action successfully.', activeHeadingOther: 'Hronaut completed {count} tab actions successfully.',
      message: 'Connect an agent and complete one safe browser action. If setup stalls, open the guided connection check.',
      failedMessage: 'The first action did not complete. Check the MCP connection separately from your client configuration.',
      activeMessage: 'Share what worked to help other users, or recommend Hronaut to another team.',
      contribute: 'Contribute ↗', welcome: 'Focused issues and signed-off code contributions are welcome.',
      troubleshoot: 'Troubleshoot connection ↗', troubleshootUnavailable: 'The connection troubleshooting guide is unavailable.',
      reportTrouble: 'Report setup trouble ↗', helpPrivacy: 'The guide opens in your default browser and receives no browser or agent data.',
      feedback: 'Share your setup result ↗', feedbackPrivacy: 'Never include credentials, tokens, private URLs, or page content.',
      feedbackUnavailable: 'The setup feedback link is unavailable.', recommend: 'Recommend Hronaut',
      recommendMessage: 'I use Hronaut to give coding agents a persistent browser: https://hronaut.dev/go/desktop-first-run-share',
      recommendPrivacy: 'Copies only this public message. No browser, workspace, or agent data is included.'
    },
    tools: { heading: 'Browser tooling', description: 'The live MCP catalog available to every connected agent.' },
    footer: 'Hronaut keeps running when its window is closed.',
    copy: { copied: 'Copied', failed: 'Copy failed', unavailable: 'The native clipboard bridge is unavailable', rejected: 'The system clipboard did not accept the text' },
    relativeTime: { now: 'just now', seconds: '{count}s ago', minutes: '{count}m ago' },
    counts: {
      requestsOne: '{count} MCP request handled', requestsOther: '{count} MCP requests handled',
      clientsOne: '{count} client', clientsOther: '{count} clients', tools: '{count} tools',
      actionsOne: '{count} action', actionsOther: '{count} actions', requests: '{count} requests'
    }
  },
  panels: {
    siteControls: 'Site controls',
    siteStorage: 'Site storage',
    pageTools: 'Page tools',
    responsivePreview: 'Responsive preview',
    environment: 'Environment',
    accessibility: 'Accessibility',
    qualityAudit: 'Quality audit',
    performance: 'Performance',
    designOverview: 'Design overview',
    pageMetadata: 'Page metadata',
    security: 'Security',
    coverage: 'Code coverage',
    cpuProfile: 'JavaScript CPU profile',
    memory: 'Memory',
    console: 'Console',
    network: 'Network monitor',
    debugReport: 'Debug report',
    reproRecorder: 'Repro recorder',
    domChanges: 'DOM changes',
    visualCompare: 'Visual compare',
    issues: 'Issues',
    bookmarks: 'Bookmarks',
    title: '{panel} — Hronaut', dock: 'Dock', right: 'Right', left: 'Left', bottom: 'Bottom', top: 'Top', separateWindow: 'Separate window', dockPanel: 'Dock panel', dockNamed: 'Dock {panel}', closePanel: 'Close {panel}', websiteRequired: 'Website required', openWebsite: 'Open a website tab', openWebsiteDescription: 'Select or open a website tab in the main Hronaut window. This panel will refresh automatically.', resize: 'Resize docked panel', resizeHelp: 'Drag to resize. Use arrow keys for precise changes; double-click to reset.', notifications: 'Application notifications', dismiss: 'Dismiss {title}'
  },
  native: {
    menu: {
      show: 'Show',
      checkUpdates: 'Check for Updates…',
      quit: 'Quit',
      edit: 'Edit',
      view: 'View',
      help: 'Help',
      commandPalette: 'Command Palette…',
      pickElement: 'Pick Element for Agent',
      reload: 'Reload Tab',
      reloadWithoutCache: 'Reload Tab Without Cache',
      developerTools: 'Developer Tools',
      actualSize: 'Actual Size',
      zoomIn: 'Zoom In',
      zoomOut: 'Zoom Out',
      shortcuts: 'Keyboard Shortcuts',
      about: 'About Hronaut',
      support: 'Commercial License',
      repository: 'GitHub Repository',
      checkUpdatesPlain: 'Check for Updates'
    },
    tray: {
      show: 'Show Hronaut',
      quit: 'Quit',
      attention: 'Attention needed: {reason}',
      showRequested: 'Show requested browser tab',
      dismissAttention: 'Dismiss attention',
      tooltipAttention: 'Hronaut — Attention needed: {reason}'
    },
    context: {
      workspace: 'Workspace: {name}', newTabWorkspace: 'New Tab in Workspace', editWorkspace: 'Edit Workspace…', sleepWorkspaceTabs: 'Sleep Eligible Tabs', archiveWorkspace: 'Archive Workspace', workspaceUnavailable: 'Workspace unavailable',
      splitView: 'Split View', sideBySide: 'Side by Side', stacked: 'Stacked', swapTabs: 'Swap Tabs', exitSplit: 'Exit Split View', openSplit: 'Open in Split View', openBeside: 'Open Tab Beside',
      newTab: 'New Tab', reloadTab: 'Reload Tab', reloadNoCache: 'Reload Tab Without Cache', duplicateTab: 'Duplicate Tab', muteTab: 'Mute Tab', unmuteTab: 'Unmute Tab', pinTab: 'Pin Tab', unpinTab: 'Unpin Tab', wakeTab: 'Wake Tab', sleepTab: 'Put Tab to Sleep',
      moveLeft: 'Move Tab Left', moveRight: 'Move Tab Right', moveUp: 'Move Tab Up', moveDown: 'Move Tab Down', closeTab: 'Close Tab', closeOthers: 'Close Other Tabs', closeRight: 'Close Tabs to the Right', closeBelow: 'Close Tabs Below', closeDuplicates: 'Close Duplicate Tabs', reopenClosed: 'Reopen Closed Tab',
      openLink: 'Open Link in New Tab', copyLink: 'Copy Link Address', saveLink: 'Save Link', openImage: 'Open Image in New Tab', copyImage: 'Copy Image', copyImageAddress: 'Copy Image Address', saveImage: 'Save Image',
      addDictionary: 'Add “{word}” to Dictionary', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', pasteMatchStyle: 'Paste and Match Style', delete: 'Delete', selectAll: 'Select All',
      back: 'Back', forward: 'Forward', reload: 'Reload', reloadWithoutCache: 'Reload Without Cache', copyPageAddress: 'Copy Page Address', inspect: 'Inspect'
    },
    pageProblem: {
      loadTitle: 'This site could not be reached', loadDefault: 'Hronaut could not load this address.', rendererTitle: 'This page stopped working', rendererDefault: 'The page process unexpectedly disappeared.',
      addressUnreachable: 'The address could not be reached.', connectionClosed: 'The connection closed before the page was received.', connectionRefused: 'The website refused the connection.', connectionReset: 'The connection was reset while loading the page.', offline: 'The device appears to be offline.', nameNotResolved: 'The website address could not be found.', networkChanged: 'The network changed while the page was loading.', timedOut: 'The website took too long to respond.',
      abnormalExit: 'The page process exited unexpectedly.', crashed: 'The page process crashed.', integrityFailure: 'The page process failed an integrity check.', killed: 'The page process was terminated.', launchFailed: 'A new page process could not be started.', outOfMemory: 'The page ran out of memory.'
    },
    errors: { clipboard: 'The system clipboard did not accept the text.', tabUnavailable: 'The tab is no longer available.', actionFailed: 'The requested browser action could not be completed.', screenshotCreate: 'Could not create the selected screenshot', linuxSecrets: 'No protected Linux secret store is available. Hronaut will not save passwords with basic-text encryption.', secureStorage: 'The operating system secure storage is unavailable.', passwordImportRead: 'Could not read the selected password file.', passwordImportTooLarge: 'The password file is larger than the 10 MB import limit.', passwordImportInvalid: 'The selected file is not a valid UTF-8 CSV password export.', passwordImportColumns: 'The CSV must contain url, username, and password columns.', passwordImportRows: 'The CSV contains more than 3,000 password rows. Split it into smaller files and try again.', passwordImportEmpty: 'No valid HTTP or HTTPS passwords were found in the selected CSV.', activationLimit: 'This commercial license has reached its device activation limit.', subscriptionInactive: 'The commercial subscription for this license is not active.', entitlementPending: 'This purchase is still being synchronized. Try again in a moment.', instanceConflict: 'This device activation is no longer available.', licenseInactive: 'This commercial license is no longer active.', licenseNotFound: 'The commercial license was not found.', invalidLicense: 'The commercial license could not be validated.', invalidLicenseKey: 'Enter the complete commercial license key from your Creem receipt.', providerUnavailable: 'The commercial license service is temporarily unavailable.', providerInvalid: 'The commercial license service returned an invalid response.', wrongProduct: 'This commercial license is not for Hronaut.' },
    dialog: {
      pageDestroyedTitle: 'This page is no longer available', pageDestroyedMessage: 'Close this tab and reopen it from Recently closed.', pageUnavailable: 'Page unavailable',
      unresponsiveTitle: "This page isn't responding", unresponsiveMessage: 'You can wait for it to recover or reload it now.', saveDownload: 'Save download',
      chooseDownloadFolder: 'Choose download folder', useFolder: 'Use this folder',
      sitePermission: 'Site permission', permissionRequest: '{origin} requests “{permission}” permission.', deny: 'Deny', allow: 'Allow',
      requestedDevices: 'Requested devices: {devices}.', devicesUnknown: 'Requested media devices were not specified.', requestedFile: 'Requested {access}: {path}. This decision will apply only once.',
      camera: 'camera', microphone: 'microphone', and: ' and ', unspecifiedAccess: 'unspecified access', unspecifiedPath: 'unspecified path',
      permissionRemember: 'Hronaut can remember this choice for the exact website origin.', permissionAskAgain: '{detail} Hronaut will ask again next time.', permissionSettings: '{detail} You can change it later in Settings → Site permissions.',
      mcpFailedTitle: 'MCP server failed to start', mcpFailedMessage: 'Could not listen on {host}:{port}',
      importPasswordsFile: 'Choose browser password CSV', choosePasswordFile: 'Choose CSV', importPasswordsTitle: 'Import saved passwords?', importPasswordsMessage: 'Import {count} saved accounts into Hronaut?', importPasswordsDetail: 'New: {added} · updates: {updated} · skipped: {skipped}\n\nAccepted passwords will be re-encrypted with {backend}. The selected CSV remains readable on disk; delete it after import.', cancel: 'Cancel', importPasswords: 'Import passwords',
      savePasswordTitle: 'Save password?', updatePasswordTitle: 'Update saved password?', savePasswordMessage: 'Save the password for {account}?', updatePasswordMessage: 'Update the password for {account}?', unnamedAccount: 'an unnamed account',
      passwordDetail: "{origin}\n\nPasswords are encrypted with the operating system's secure storage. The vault itself is never exposed through MCP.", notNow: 'Not now', savePassword: 'Save password', updatePassword: 'Update password',
      installingUpdate: 'Installing the update. Hronaut will restart automatically.', restartingUpdate: 'The new package is installed. Restarting Hronaut to finish the update.'
    }
  }
}

export type MessageSchema = typeof enUS
