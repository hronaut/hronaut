// Words that find each Settings section by the settings it holds, the headings that group Appearance's and General's
// rows, and General's own heading.
// Keywords are only searched, never shown; product and technical names stay as they are.
export const enUSSettingsSections = {
  keywords: {
    appearance: 'interface size scale zoom tab position left top title bar dark light mode system cyberpunk',
    general: 'language interface system tray close startup sign in login launch minimized attention sound cursor live status strip agent agents spell check spelling dictionary',
    search: 'address bar site search shortcut keyword google duckduckgo bing brave startpage',
    downloads: 'folder location save ask file',
    performance: 'memory saver sleep cpu inactive tabs graphics acceleration gpu hardware',
    mcp: 'token authentication port remote network lan tool set capability profile captcha url agents',
    privacy: 'workspace profile history clear cookies storage data copy move transfer websites secure dns doh dns over https encrypted cloudflare google quad9',
    permissions: 'camera microphone location notifications clipboard files allow deny',
    credentials: 'password login sign in credentials',
    wallets: 'crypto evm solana tron vault passphrase',
    updates: 'version check release notes',
    support: 'license key activate subscription trial buy creem'
  },
  appearanceGroups: {
    window: 'Window'
  },
  generalGroups: {
    startup: 'Startup and tray',
    agents: 'Agent activity'
  },
  general: {
    heading: 'General',
    description: 'Choose Hronaut’s language, how it starts, and how agent activity shows.'
  }
}
