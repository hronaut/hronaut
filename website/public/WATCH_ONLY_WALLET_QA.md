# Watch-only public-address wallet QA

This companion recipe targets **Hronaut 2.4.31 or newer**. It verifies Hronaut's watch-only boundary with a disposable local EVM chain and one public address. It does not import, generate, or request a seed phrase or private key, and it never needs real funds.

Use this when the QA question is whether a dApp or coding agent can observe a known account without gaining signing authority. Use the separate [local EVM wallet QA quickstart](WALLET_QA_QUICKSTART.md) only when the test specifically needs disposable signing, approval, submission, and receipt behavior.

## Scope and expected matrix

| Check | Expected result |
| --- | --- |
| `wallet_list` before account permission | The watch-only wallet is listed with `capabilities: ["read"]`; its public address remains hidden. |
| `wallet_balance` before account permission | Hronaut returns `permission-required` and creates a trusted account-access request. The agent cannot approve it. |
| `wallet_balance` after human approval | Hronaut returns the public address and the local native balance. |
| EIP-1193 account request | A person may grant read access to the public address for the exact workspace and top-level origin. |
| Message signing, transaction signing, or sending | The request cannot complete because a watch-only wallet has no signing material or signing capability. |
| Automatic signing policy | Hronaut's trusted UI does not offer one, and the main-process authority rejects attempts to create one. |
| WalletConnect/Reown authorization | Not available. Hronaut does not integrate WalletConnect or Reown. |
| Account history, ERC-20 metadata, or NFT metadata | Outside Hronaut's current wallet tools. Test these separately with a public explorer or read-only RPC/indexer whose trust and privacy policy you accept. |

This is a bounded Hronaut wallet check, not a contract audit, RPC honesty proof, external-wallet-extension test, universal dApp compatibility result, or claim that a public address is private. Public-chain addresses and their activity are public; avoid tying a personal address to a public QA report.

## 1. Start a disposable read-only fixture

Run these commands from the Hronaut repository root. They start the same pinned Foundry distribution used by the signing quickstart, but this recipe never reads or imports an Anvil private key.

```bash
docker run --name hronaut-watch-only-anvil --detach \
  --publish 127.0.0.1:8545:8545 \
  ghcr.io/foundry-rs/foundry:v1.3.1 \
  "anvil --host 0.0.0.0 --chain-id 31337"

python3 -m http.server 4173 --bind 127.0.0.1 \
  --directory examples/wallet-qa
```

Use this synthetic public address throughout the recipe:

```text
0x000000000000000000000000000000000000dead
```

Give it exactly one local test ETH by changing node state directly. This does not create or use a signing key:

```bash
docker exec hronaut-watch-only-anvil cast rpc anvil_setBalance \
  0x000000000000000000000000000000000000dead \
  0xde0b6b3a7640000

docker exec hronaut-watch-only-anvil cast balance \
  0x000000000000000000000000000000000000dead \
  --rpc-url http://127.0.0.1:8545 --ether
```

The second command must report `1.000000000000000000`. Treat that direct node read as the fixture baseline, not as evidence about Hronaut.

Do not run `docker logs` for this recipe: Anvil logs include disposable private keys that are unnecessary here and should not enter screenshots or reports.

## 2. Add only the public address

These are human-owned trusted Settings steps:

1. Create a disposable Hronaut workspace and open `http://127.0.0.1:4173` in it.
2. Open **Settings → Wallets → Add wallet → Watch-only**.
3. Name the account `Watch-only QA`, choose EVM and the local Anvil network, and enter only the public address above. Confirm chain ID `31337`, RPC URL `http://127.0.0.1:8545`, and access limited to the disposable workspace.
4. In **Your wallets**, verify that the account type is watch-only and the only capability is read. There is no recovery-material step because Hronaut has received no secret.
5. In **Access & automation**, verify that Hronaut does not offer a signing automation policy for this wallet.

Do not substitute a funded address, personal account, production RPC, recovery phrase, private key, or WalletConnect session. A public address is sufficient for every positive check in this recipe.

## 3. Verify account privacy and balance through MCP

Connect a trusted local MCP client using the current instructions shown on Hronaut Home. Ask it to operate only the disposable workspace and tab.

1. Call `wallet_list`. Record the returned `walletSessionId` privately for the current MCP session. The `Watch-only QA` descriptor must show `kind: "watch-only"`, `capabilities: ["read"]`, and `addressPermission: false`; it must not contain `publicAddress` or the configured RPC URL.
2. Call `wallet_balance` with that session and wallet ID. It must return `permission-required`, not the balance or address.
3. Inspect the trusted Hronaut account-access request and approve it manually. The MCP client has no approval tool.
4. Call `wallet_balance` again with the same live wallet session. It must report `status: "ready"`, the synthetic public address, network `31337`, and balance `"1"`.
5. Start a fresh MCP connection or revoke the permission in **Access & automation**. A new wallet session must not inherit the old session token, and a revoked permission must return to `permission-required`.

Never paste a `walletSessionId`, workspace resume key, MCP bearer token, or private URL into a public result. The public address in this recipe is intentionally synthetic; account permissions and session capabilities are still private local authority.

## 4. Verify website read permission

In the local fixture page:

1. Select **Discover provider**. The page must discover Hronaut through EIP-6963.
2. Select **Request accounts** and reject the trusted Hronaut request. The page must receive error `4001`, and no address is exposed.
3. Request accounts again and approve. The fixture records only an account count, while the provider returns the public address to this exact top-level origin.
4. Revoke the website permission in Hronaut. The page must receive `accountsChanged` with a count of zero.

This permission authorizes observation of the public address. It does not add a secret or upgrade the wallet to signing capability.

## 5. Run negative controls below the UI

After restoring account permission, select **Send 1 wei** in the fixture. Even if the trusted request is reviewed, a watch-only wallet cannot produce a signature or transaction hash. Do not retry an uncertain write; inspect **Activity** and the fixture result first. In this deterministic local case the request must finish failed without a broadcast.

For source-level proof that this boundary is enforced in the main process rather than only by hiding controls, run the focused Docker regression checks:

```bash
npm run test:unit:docker:focused -- \
  tests/wallet-service.test.ts \
  tests/wallet-broker.test.ts \
  tests/renderer/wallet-settings-panel.test.ts \
  -t "watch-only"
```

The checks cover rejection of watch-only signing automation, read-only account capability advertisement, and the trusted UI's absence of signing-policy controls. The wallet descriptor schema and signer also reject signing capability or secret material for watch-only records.

If your evaluation uses `wallet_request`, a `sign-message`, `sign-transaction`, or `sign-and-send` request may create a reviewable request, but approval cannot make it sign: the durable result must become failed and no transaction hash may appear. An agent still cannot approve the request itself.

## 6. Clean up and report precisely

Stop the Python server with **Ctrl+C**, remove the disposable node, then remove the test wallet and workspace in Hronaut:

```bash
docker rm --force hronaut-watch-only-anvil
```

Report each matrix row as passed, failed, not attempted, or unknown. Include the Hronaut version, OS, MCP client, local chain ID, and whether the result came from Hronaut, the page fixture, or the direct node read. Do not claim transaction, token, NFT, contract, external-wallet, or public-network coverage from this recipe.

For the complete trust boundary and supported methods, see [Hronaut local wallets](WALLETS.md).
