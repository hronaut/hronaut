/**
 * The words of Hronaut's own dialogs that main asks through the shell (see `src/shared/trusted-dialogs.ts`). A
 * dialog's buttons, and the lines it shares with the system dialog Hronaut falls back to, stay in `native.dialog`; a
 * website's sign-in, which no system dialog asks, keeps its own.
 */
export const enUSTrustedDialogs = {
  close: 'Close',
  httpAuth: {
    eyebrow: 'Sign in',
    headline: 'Sign in to {origin}',
    notPrivate: 'Your connection to this site is not private. Anyone on the network can read your username and password.',
    workspace: 'You stay signed in to this website in the “{workspace}” workspace until Hronaut quits.',
    sent: 'Hronaut sends your username and password only to this website and never shows them to agents.',
    username: 'Username',
    password: 'Password',
    signIn: 'Sign in'
  },
  certificate: {
    eyebrow: 'Not private',
    headline: 'Proceed to {host}?',
    authority: 'Its security certificate is not from an authority this computer trusts.',
    name: 'Its security certificate is for another website.',
    date: 'Its security certificate has expired or is not valid yet.',
    other: 'Its security certificate cannot be verified.',
    risk: 'Someone on the network might be pretending to be this website to read what you send it, such as passwords.',
    workspace: 'Hronaut trusts this certificate for this website in the “{workspace}” workspace until it quits, and agents in the workspace can open it too.',
    session: 'Hronaut trusts this certificate for this website until it quits.',
    back: 'Back to safety',
    proceed: 'Proceed (unsafe)'
  },
  savePassword: {
    eyebrow: 'Saved passwords',
    save: 'Save your password for {origin}?',
    update: 'Update your saved password for {origin}?',
    username: 'Username',
    noUsername: 'The page sent no username with it.',
    stored: 'Hronaut encrypts it with your operating system’s secure storage. Saved passwords are never exposed through MCP.'
  },
  walletRecovery: {
    eyebrow: 'New wallet',
    headline: 'Write down the recovery phrase for {wallet}',
    phrase: 'Recovery phrase',
    keep: 'Write these words down in order and keep them offline. Anyone who has them controls the wallet.',
    added: 'Hronaut adds the wallet once you confirm you saved them.'
  },
  claudeSetup: {
    file: 'File',
    added: 'New entry in "mcpServers"',
    replaces: 'Entry it replaces'
  },
  sitePermission: {
    embeddedIn: 'Embedded in {site}',
    wants: {
      camera: '{origin} wants to use your camera',
      microphone: '{origin} wants to use your microphone',
      cameraAndMicrophone: '{origin} wants to use your camera and microphone',
      geolocation: '{origin} wants to know your location',
      notifications: '{origin} wants to show notifications',
      clipboardRead: '{origin} wants to see text and images you copy',
      clipboardWrite: '{origin} wants to copy text and images to your clipboard',
      midiSysex: '{origin} wants to control and reprogram your MIDI devices',
      midi: '{origin} wants to use your MIDI devices',
      localFonts: '{origin} wants to use the fonts on your computer',
      localNetwork: '{origin} wants to find and connect to devices on your local network',
      loopbackNetwork: '{origin} wants to connect to apps and services on this device',
      fileSystem: '{origin} wants to use a file or folder on your computer',
      openExternal: '{origin} wants to open an app on your computer',
      fullscreen: '{origin} wants to use the full screen',
      idleDetection: '{origin} wants to know when you are using this device',
      keyboardLock: '{origin} wants to capture your keyboard shortcuts',
      pointerLock: '{origin} wants to lock and hide your mouse pointer',
      persistentStorage: '{origin} wants to store data permanently on this device',
      screenWakeLock: '{origin} wants to keep your screen on',
      storageAccess: '{origin} wants to use its cookies and site data on this page',
      topLevelStorageAccess: '{origin} wants to use cookies and site data of related websites',
      windowManagement: '{origin} wants to manage windows on all your displays',
      displayCapture: '{origin} wants to see your screen',
      other: '{origin} wants to use “{permission}”'
    }
  }
}
