# External-wallet and mobile dApp QA boundary

This companion guide describes the wallet QA scope of **Hronaut 2.4.31 or newer**. Hronaut can test its own local EVM, Solana, and Tron providers in a visible, workspace-isolated browser. It does not host or impersonate a third-party wallet, and a passing Hronaut run is not evidence that an extension, WalletConnect session, or mobile wallet works.

Use this page to split one dApp evaluation into two independently reported suites:

1. a safe Hronaut suite for local provider, workspace/origin authority, trusted approval, and observable application or local-chain behavior; and
2. the dApp team's external-wallet suite for each actual extension, SDK, relay, QR/deep-link handoff, or mobile application it supports.

Neither suite should use a production dApp, funded account, real transaction, personal public address, recovery phrase, private key, MCP token, or wallet session identifier.

## Supported and unsupported matrix

| QA question | Hronaut local suite | External-wallet or mobile suite |
| --- | --- | --- |
| Discover and call Hronaut's EIP-1193/EIP-6963, Solana Wallet Standard, legacy Solana, or Tron/TIP-6963 provider | Supported for Hronaut's documented methods | Test every claimed third-party provider separately |
| Observe a synthetic public address and local balance without signing material | Supported with a Hronaut watch-only wallet | Test the third-party wallet's own read-only/account behavior separately |
| Exercise local disposable signing, trusted rejection/approval, submission, and receipt read-back | Supported with valueless fixture accounts on a disposable local chain | Test the external wallet's confirmation, signing, and submission UI separately |
| Enforce Hronaut workspace, top-level origin, navigation, account, chain, session, and expiry boundaries | Supported | Does not prove equivalent isolation in another wallet |
| Inject or automate MetaMask, Phantom, TronLink, or another browser extension | Not supported | Required when that extension is in product scope |
| Establish WalletConnect/Reown relay sessions or scan pairing QR codes | Not supported | Required when WalletConnect/Reown is in product scope |
| Open, deep-link to, approve in, or return from a mobile wallet application | Not supported | Required on every supported mobile operating system and wallet |
| Validate proprietary wallet SDKs, hosted custody, remote signing, provider-specific RPC behavior, or extension updates | Not supported | Required against the exact provider and version claimed by the dApp |

Hronaut does not integrate WalletConnect, Reown, MetaMask SDK, Phantom SDK, TronLink SDK, hosted custody, or proprietary wallet infrastructure. It does not claim universal dApp compatibility, external-wallet compatibility, a wallet security audit, or proof that an RPC reports honest chain state.

## Phase A: run the safe Hronaut suite

Prefer the [watch-only public-address recipe](WATCH_ONLY_WALLET_QA.md). It uses local Anvil, the synthetic address `0x000000000000000000000000000000000000dead`, and no signing material. Use the separate [local EVM signing quickstart](WALLET_QA_QUICKSTART.md) only when the test specifically needs disposable signing, submission, and receipt behavior.

Create a disposable Hronaut workspace and serve only the repository's local `examples/wallet-qa` fixture. Keep network identity, RPC URL, workspace, origin, provider, and Hronaut version in the private test record. Do not substitute production access or a value-bearing account.

Record each attempt as distinct evidence stages. A later stage must never be inferred from an earlier one:

| Evidence stage | What it proves | What it does not prove |
| --- | --- | --- |
| Provider selection and validation | The expected page provider was selected and has the requested interface | Hronaut authorization, backend dispatch, or wallet behavior |
| Hronaut authorization | Trusted Hronaut policy or a person allowed or rejected the exact request | Provider dispatch, signature, or submission |
| Dispatch | The request reached the selected Hronaut wallet operation | Signature, transaction submission, or application success |
| Submission | A local node accepted a transaction and returned a hash | Confirmation or the intended application state |
| Independent observation | A fresh page read-back or direct local-node read observed the expected state | Compatibility with any external wallet |
| Unknown outcome | Available evidence cannot establish whether dispatch, submission, or state change occurred | Permission to retry a consequential operation |

For an uncertain write, do not automatically retry. Check Hronaut **Wallets → Activity**, query the existing request status when available, and perform a fresh application or direct local-chain read. Report unresolved stages as `unknown`.

## Required negative controls

Run these controls with the disposable fixture and report the first stage that rejected or lost the operation:

| Control | Expected boundary and evidence |
| --- | --- |
| Reject account connection | Provider error `4001`; no address grant. This is provider rejection, not dispatch or submission. |
| Wrong workspace or top-level origin | Hronaut authorization rejects the request; no wallet dispatch or submission may be claimed. |
| Navigate, reload, or replace the tab before acting on an old request | The old origin/navigation authority becomes stale and the request is cancelled or rejected. A new page must obtain fresh authority. |
| Revoke account permission or start a fresh MCP connection | The old address/session authority no longer works; a new account-access decision is required. |
| Ask a watch-only wallet to sign or send | The main-process authority fails closed because there is no signing capability or material; no transaction hash may appear. |
| Let an untouched request expire | Its durable state becomes expired; a late approval or retry cannot revive it. |
| Lose the result around dispatch or submission | Classify dispatch, submission, and observed state independently. Preserve `unknown` where evidence is missing and do not infer failure or success from a rejected or resolved JavaScript promise alone. |

An MCP coding agent cannot approve its own account or signing request. A page prompt, wallet metadata, or agent instruction also cannot grant authority. Human approval occurs only in trusted Hronaut chrome and remains bound to the displayed request.

## Phase B: hand off to the external-wallet suite

After Phase A, give the dApp team only the non-secret fixture description, expected user journey, and stage-based result template. The external suite should use its own controlled test account and tooling to cover:

- the exact extension or mobile-wallet name, version, browser, operating system, and connection transport;
- installation, discovery, connection rejection and approval, account or chain changes, lock/disconnect, and provider removal;
- QR expiry, relay loss, mobile deep-link cancellation, background/foreground transitions, and return-to-browser behavior when applicable;
- provider-specific request errors, confirmation UI, fee presentation, signature format, submission, and independent state read-back; and
- the same wrong-account, wrong-chain, stale-session, rejected-request, expiry, and unknown-outcome controls.

Do not transfer a Hronaut approval, permission, wallet session, account, or compatibility conclusion into Phase B. External-wallet results belong to that provider/version combination only.

## Report without overclaiming

For every case, record `passed`, `failed`, `not attempted`, or `unknown`, followed by:

- suite: `Hronaut local` or the exact external provider;
- Hronaut/provider version, OS, browser, transport, workspace, top-level origin, and local network identity;
- the last established evidence stage: provider selection, Hronaut/provider authorization, dispatch, submission, or independent observation;
- whether a person approved or rejected the request;
- whether a fresh page or direct-chain read confirmed the intended state; and
- sanitized error category and recovery action, with no secrets, tokens, raw signed payloads, private RPC URLs, or personal addresses.

A suitable conclusion is: “The Hronaut local-provider suite passed for the listed version and fixture; external-wallet and mobile compatibility were not tested.” Never shorten that to “wallet support passed” unless every claimed external provider has its own current evidence.

For the complete local-wallet trust model, see [Hronaut local wallets](WALLETS.md).
