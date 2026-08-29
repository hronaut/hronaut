# Hronaut local wallets

Hronaut provides locally managed EVM, Solana, and Tron wallets to websites and MCP coding agents without giving either party private keys, seed phrases, decrypted vault data, or an approval capability. Wallets are optional and disabled for signing when Hronaut cannot establish secure vault protection. Watch-only accounts remain available.

Hronaut does **not** integrate WalletConnect, Reown, MetaMask SDK, Phantom SDK, TronLink SDK, hosted custody, hosted relays, or proprietary wallet infrastructure.

## Security boundary and threat model

The trusted signer, encrypted vault, policy engine, transaction adapters, and approval state machine run in Electron's main process. Normal website pages retain context isolation, sandboxing, and no Node.js access. The website preload exposes only validated provider methods. The Hronaut Vue renderer receives public descriptors and sanitized approval summaries, never key material or encrypted vault blobs.

Hronaut protects against a website or MCP agent directly reading keys, approving its own request, silently crossing workspace/origin boundaries, replaying a mutated approval, or automating a mainnet signature. Requests are bound to the wallet, workspace, top-level HTTP(S) origin, account, chain/network, requesting website or agent, active tab, navigation generation, nonce or recent blockhash when available, expiry, and a SHA-256 approval hash. Navigation, tab/workspace closure, permission revocation, or request expiry cancels applicable pending work.

The trusted approval dialog is Hronaut chrome. While it is open, website WebContents are moved out of the interactive content region; a page cannot overlay or click the approval. The dialog shows the wallet/account, network, origin, workspace, requesting agent, decoded destination/action/amount, simulation, estimated fee, expiry, approval hash, and expandable unsigned details.

Hronaut cannot protect against a compromised operating system, malware running as the same user, a malicious Electron/Chromium runtime, screen or input capture outside Hronaut, a malicious RPC lying about chain state, or a user approving a misleading but accurately displayed request. JavaScript and Electron do not guarantee deterministic memory erasure; Hronaut uses short-lived buffers and best-effort overwrite after signing, but copies may exist transiently in the runtime.

## Wallet types and onboarding

Open **Settings → Wallets** to:

- generate a Hronaut-managed wallet;
- import a mnemonic or private key;
- add a watch-only public address;
- designate a generated or imported account as a dedicated agent wallet;
- rename/remove wallets and attach them to workspaces;
- configure policies, revoke website/agent account permissions, and inspect pending requests or audit history.

Create separate accounts for EVM, Solana, and Tron unless you intentionally accept the larger blast radius of reusing recovery material. Hronaut never silently derives all three families from one seed.

Generated recovery material is displayed only in a native trusted Hronaut dialog. The wallet is enabled only after you confirm that the recovery material was saved; choosing **Not yet**, losing the trusted dialog, or failing to persist that confirmation discards the new wallet so an unrecoverable account is never retained. Imported material is entered only in trusted Settings, validated in the main process, cleared from the UI immediately, and retained in memory only for a five-minute confirmation window. Hronaut automatically zeroes and drops an unconfirmed import when that timer expires, even if the user takes no further action. Validation errors never echo secret fragments.

Removing a managed wallet deletes its encrypted local record and revokes its permissions and policies. Removal is not a recovery mechanism: retain your recovery material independently.

## Vault protection

Each wallet secret is encrypted with XChaCha20-Poly1305 using a random data-encryption key. Wallet ID, schema version, and chain family are authenticated metadata, so modified, truncated, or substituted records are rejected. The vault supports authenticated schema migration and data-key rotation.

On Windows and macOS, and on Linux with a secure Secret Service/KWallet backend, Electron `safeStorage` wraps the data-encryption key. Electron's asynchronous encryption APIs are used. On Linux, `basic_text` is never considered secure. When Hronaut detects `basic_text`, an unknown backend, or no available secure store, it requires a user passphrase and derives the wrapping key with Argon2id (64 MiB, three passes, one lane) through the MIT-licensed RustCrypto Node-API binding. Failure to initialize either protection mode disables managed signing without silently downgrading; watch-only wallets remain usable.

Wallet files live below Electron's Hronaut application-data directory in `wallet/`. Never copy `vault.json` as a substitute for recovery material. Neither the renderer nor website profiles, localStorage, IndexedDB, cookies, command-line arguments, environment variables, logs, audit events, telemetry, or MCP responses contain plaintext wallet secrets. Pending message bodies are kept only in main-process memory; the durable request record contains a digest and length.

## Website provider support

Only wallets attached to the current workspace are eligible, and an address remains hidden until the top-level origin and requester receive explicit account permission. Cross-origin iframe wallet requests are denied by default and attributed to the top-level origin.

### EVM

Hronaut exposes an EIP-1193 provider and announces it with EIP-6963. Supported methods are `eth_accounts`, `eth_requestAccounts`, `eth_chainId`, `wallet_switchEthereumChain` for the already configured network, `eth_sendTransaction`, `eth_signTransaction`, `personal_sign`, `eth_signTypedData_v4`, and `eth_sign`. Raw `eth_sign` always requires trusted human approval. Private-key, seed, arbitrary RPC-forwarding, and unknown methods are rejected.

### Solana

Hronaut registers a Solana Wallet Standard wallet with connect/disconnect, events, sign transaction, sign-and-send transaction, and sign message features. Disconnect revokes only that Solana wallet's permission for the requesting website and cancels its matching pending requests; unrelated same-origin chain connections remain available. A narrow `window.solana` compatibility surface supports common legacy transaction objects, including legacy and versioned serialized transactions and batch signing. The requested signer account and `solana:<network>` chain are validated.

### Tron

Hronaut exposes `window.tron` and TIP-6963 discovery without claiming to be TronLink. It supports `eth_accounts`, `eth_requestAccounts`, configured-network switching, transaction signing, sign-and-send, and message signing. After authorization, `provider.tronWeb` exposes the selected address and narrow `trx.sign`/`trx.signMessageV2` compatibility. Dapps should use their own public TronWeb instance to build unsigned transactions, then ask Hronaut to sign. Address, owner, and network consistency are validated.

## Approval and automation

Requests advance through `draft → validated → simulated → policy-decision → awaiting-human/approved → signing → submitted → confirmed`, or a terminal rejected, expired, cancelled, or failed state. A simulation, audit, or state-preparation error moves its request to `failed` immediately, so trusted chrome cannot approve a request whose caller already received an error. Once a human decision, cancellation, revocation, or expiry makes a request terminal, Hronaut settles its caller, stops its timer, and clears retained in-memory message bytes even if the corresponding audit write fails. An untouched request expires automatically at its displayed deadline; no approval click or application restart is required. Signing checks the exact normalized request hash again immediately before key use. Durable request IDs and idempotency keys prevent duplicate submission.

The default policy is deny/ask. Mainnet signing and sending always require a person. Automatic approval is available only when Hronaut independently recognizes an allowlisted testnet, or a known local-chain ID paired with a loopback RPC URL. A user-supplied `testnet` label is not trusted: unknown, mislabeled, public-hosted local, and mainnet networks always return to human approval. Eligible policies can restrict wallet/workspace, network, origin, destination/contract/program, method/instruction, per-transaction native amount, session/daily spend, fee, expiry, operation count, and successful simulation. Unknown or undecodable actions, unlimited approvals, new contracts/programs, blind/raw messages, permission changes, recovery export, and vault changes always require a person.

## MCP agent operations

The MCP catalog exposes only:

- `wallet_list`
- `wallet_balance`
- `wallet_prepare_transaction`
- `wallet_request`
- `wallet_request_status`
- `wallet_cancel_request`

`wallet_list` opens an unguessable, short-lived wallet agent session bound to the caller's isolated workspace and active tab/top-level origin. Every other wallet tool requires that returned `walletSessionId`; it cannot be used in another workspace or tab and expires after inactivity. Starting a fresh wallet session requires account permission again. The optional `agentName` is display-only and appears in trusted approvals. An agent cannot approve a request. There is no decrypt, export, raw-vault, private-key, mnemonic, generic RPC-forwarding, or approval tool.

## RPC configuration and testing

Set an HTTP(S) RPC URL for each wallet network in **Settings → Wallets**. Hronaut does not ship third-party API keys. Treat RPC operators as part of the transaction-information trust boundary and prefer your own or explicitly trusted endpoints.

Use local/test networks and valueless accounts for development. Hronaut's fast and authoritative suites run inside Docker with deterministic RPC fixtures for EVM, Solana, and Tron adapter behavior; they never submit mainnet transactions or use real funds. The fixtures cover normalized transaction preparation, simulation, fee estimation, signing, broadcasting, confirmation, malformed responses, chain/account mismatches, replay, and concurrent request isolation without depending on a mutable public testnet. Real-node smoke testing should use a disposable Anvil, `solana-test-validator`, or private Tron node outside the default suite when those large runtimes are available locally.

## Revocation and incident response

In **Settings → Wallets**, detach the wallet from a workspace, revoke each account permission, remove bounded policies, cancel pending requests, lock the passphrase-protected vault, or remove the wallet. Detaching, permission revocation, wallet removal, navigation, renderer destruction, tab closure, and workspace removal cancel matching pending requests immediately. Hronaut also revalidates the current workspace attachment and account permission at the signing boundary. If recovery material may be compromised, move funds with a separately trusted wallet and retire the account; local revocation cannot invalidate a blockchain key already copied elsewhere.
