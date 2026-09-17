# Local EVM wallet QA quickstart

This reproducible smoke test targets **Hronaut 2.4.21 or newer** and Foundry Anvil 1.3.1. The local-wallet feature is available as a preview: its API may evolve, but it is included in the named release.

The test uses only a disposable local chain and Anvil's public test key. Do not use a real recovery phrase, private key, funded account, or mainnet RPC. Delete the test wallet and containers when finished.

## What this test covers

The fixture demonstrates Hronaut's EIP-6963 discovery and EIP-1193 provider, accepted and rejected account connections, `accountsChanged` and `chainChanged`, accepted and rejected transaction approvals, a successful receipt, a delayed receipt, and a reverted receipt. It distinguishes these stages:

| Stage | Evidence |
| --- | --- |
| prepared | Hronaut has validated and simulated the request and shows its trusted approval. There is no transaction hash yet. |
| submitted | `eth_sendTransaction` returns a hash. The receipt can still be `null`, so this is not success. |
| confirmed | An authoritative `eth_getTransactionReceipt` read from the local chain has `status: "0x1"`. |
| failed | The authoritative receipt has `status: "0x0"`, or Hronaut rejects the request before submission. |

The fixture gives every provider attempt and local receipt read a page-local `request-N` ID. A `request:start` entry records the method, the `provider` or `local-rpc-read` channel, and an allowlisted input summary. It does not record account addresses, transaction hashes, recipient addresses, signing payloads, RPC URLs, raw receipts, or provider error messages. Account events and results contain counts; transaction results say whether a hash was returned; receipt results contain only presence, bounded status, and block-number presence.

Provider evidence then records one of these stages:

- `provider-selection` means the fixture stopped before invoking a provider. `providerInvoked: false` and `walletBehavior: "not-exercised"` are a fixture result, not a wallet pass.
- `provider-validation` means discovery returned an object without a callable provider request function. It is also a pre-invocation fixture failure, so wallet behavior was not exercised.
- `provider-invocation` means the JavaScript provider's `request` method was called. Wallet-backend dispatch, approval, broadcast, and confirmation remain `unknown` because the page cannot establish them from that call.
- `provider-result` or `provider-rejection` records the correlated JavaScript provider outcome without claiming where a rejection originated.
- `local-receipt-read`, `local-receipt-result`, and `local-receipt-rejection` belong to the independent loopback RPC read. They explicitly record `walletBehavior: "not-exercised"` and cannot be treated as wallet approval evidence.

The automated fixture regression includes a deterministic pre-dispatch control with zero provider calls and a separate stub-provider rejection with exactly one call. Neither uses a real wallet, network, approval, signature, or transaction.

This does not test MetaMask, Coinbase Wallet, Phantom, or TronLink extension UI. Hronaut does not impersonate those products. It also does not establish WalletConnect or Reown compatibility. Keep separate real-extension tests when your supported matrix includes them. Solana and Tron require their own chain-specific fixtures and are outside this EVM first run.

## 1. Start disposable chains and the fixture

Run these commands from the Hronaut repository root. The image is from the [official Foundry container distribution](https://getfoundry.sh/getting-started/installation#using-foundry-with-docker), pinned here to the tested version.

```bash
docker run --name hronaut-wallet-anvil --detach \
  --publish 127.0.0.1:8545:8545 \
  ghcr.io/foundry-rs/foundry:v1.3.1 \
  "anvil --host 0.0.0.0 --chain-id 31337"

python3 -m http.server 4173 --bind 127.0.0.1 \
  --directory examples/wallet-qa
```

Anvil creates only disposable development accounts. Display the generated accounts and keys, then use the first key shown for this run:

```bash
docker logs hronaut-wallet-anvil
```

Do not save that key in the repository, shell history, screenshots, or issue reports. Never reuse it outside this throwaway local chain.

## 2. Configure Hronaut

These setup and approval steps are deliberately human-only.

1. Create or choose a disposable workspace, then open `http://127.0.0.1:4173` in that workspace.
2. Open **Settings → Wallets → Add wallet**. Import the first Anvil key printed by the container as an EVM wallet, choose the local Anvil preset with chain ID `31337` and RPC URL `http://127.0.0.1:8545`, and attach it only to this workspace. Confirm recovery only because this key belongs to the disposable local chain.
3. In **Your wallets**, verify the saved network identity and RPC endpoint before using the wallet.
4. Leave automatic policies disabled for the approval checks. Keep the Settings window available so you can inspect **Activity**, revoke permission, and lock the vault.

The fixture cannot import a key, attach a workspace, grant account permission, approve a request, or create a bypass policy. An agent may drive the dApp controls, but a person owns those trusted Hronaut decisions. Solana and Tron public testnets also require human transaction approval; only the documented, bounded EVM local/testnet policy can automate eligible requests.

## 3. Check discovery, connect, and account changes

1. Click **Discover provider**. The log must show an EIP-6963 announcement with `rdns: "dev.hronaut.wallet"` and `isHronaut: true`.
2. Click **Request accounts**, then reject the trusted Hronaut dialog. The fixture must log a correlated `provider-rejection` with error code `4001`, while wallet dispatch and approval remain `unknown` and no account is exposed.
3. Request accounts again and approve. The fixture logs the disposable account count and an `accountsChanged` count without recording the address.
4. In Hronaut Settings, revoke that website permission or lock the vault. The fixture must log an `accountsChanged` count of zero. Unlock if needed, request accounts again, and approve before continuing.

For a real network-change event, start a second disposable node:

```bash
docker run --name hronaut-wallet-anvil-2 --detach \
  --publish 127.0.0.1:8546:8545 \
  ghcr.io/foundry-rs/foundry:v1.3.1 \
  "anvil --host 0.0.0.0 --chain-id 31338"
```

Import the same disposable Anvil key as a second Hronaut wallet, select a custom EVM network with chain ID `31338` at `http://127.0.0.1:8546` during setup, and attach it only to the test workspace. In the fixture, **Switch chain** defaults to `0x7a6a`, which is 31338. The log must show `chainChanged: "0x7a6a"` and an empty account list until you explicitly request and approve account access on that network. Switch back by entering `0x7a69` for 31337; set the receipt RPC field back to port 8545.

## 4. Check approval, submission, and confirmation

Use chain 31337 and the fixture's default recipient.

1. Click **Send 1 wei** and inspect the trusted approval. At this prepared stage, Hronaut has simulated the exact request but the dApp has no hash. Reject it. The fixture must log error `4001`, and the hash field stays empty.
2. Click **Send 1 wei** again and approve. The fixture stores the returned hash in its input but logs only `transactionHashReturned: true` and `transactionState: "submitted"`.
3. Click **Read receipt**. The fixture makes an independent `eth_getTransactionReceipt` call to Anvil. A successful final summary has `receiptStatus: "confirmed"`, `blockNumberPresent: true`, and the same correlated request ID through the local read stages. Hronaut **Activity** should progress from submitted to confirmed.

The direct readback is authoritative for this test. Do not infer confirmation from the approval dialog closing or from receipt polling alone.

## 5. Check a delayed receipt

Disable automining, submit once, and preserve the returned hash:

```bash
docker exec hronaut-wallet-anvil cast rpc anvil_setAutomine false
```

Click **Send 1 wei** and approve. **Read receipt** returns `null`; Hronaut remains submitted and continues bounded polling. Do not resubmit. Mine the existing transaction, then read the same hash again:

```bash
docker exec hronaut-wallet-anvil cast rpc evm_mine
```

The receipt summary now has `receiptStatus: "confirmed"`, and Hronaut eventually records confirmed. If the RPC is temporarily unavailable, retain the hash and reconcile after restoring the same chain; an unavailable receipt is an unknown outcome, not permission to send again.

## 6. Check a reverted receipt

Keep automining disabled. Change the fixture recipient to `0x2000000000000000000000000000000000000002`, click **Send 1 wei**, approve, and wait for the submitted hash. The pre-submit simulation succeeds because the address has no code. Before mining, install a tiny always-revert runtime at that address and mine the already submitted transaction:

```bash
docker exec hronaut-wallet-anvil cast rpc anvil_setCode \
  0x2000000000000000000000000000000000000002 0x60006000fd
docker exec hronaut-wallet-anvil cast rpc evm_mine
```

Read the same hash. The receipt summary must have `receiptStatus: "failed"`; Hronaut **Activity** eventually records failed. The hash still identifies a submission, not a successful transfer.

Restore automining if you want to continue:

```bash
docker exec hronaut-wallet-anvil cast rpc anvil_setAutomine true
```

## 7. Reset and clean up

Stop the Python server with **Ctrl+C**. Remove the primary disposable chain, then remove the optional second container only if you started it.

```bash
docker rm --force hronaut-wallet-anvil
docker rm --force hronaut-wallet-anvil-2 # only if step 3 created it
```

In Hronaut, remove both test wallets and clear or delete the disposable workspace. Starting the containers again creates fresh chain state, so old transaction hashes must not be interpreted against the new instances.

For the complete security model, supported methods, vault behavior, and automation boundaries, see [Hronaut local wallets](WALLETS.md).
