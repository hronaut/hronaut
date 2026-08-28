# Third-party notices

Hronaut depends on and bundles third-party open-source software. Each dependency remains under its own license; the PolyForm Noncommercial license for Hronaut does not replace those terms. Complete dependency names, versions, and integrity hashes are recorded in `package-lock.json`.

Notable code and assets compiled into the desktop application include:

- **axe-core 4.13.0**, Copyright Deque Systems, Inc. and contributors, licensed under the Mozilla Public License 2.0. Source: <https://github.com/dequelabs/axe-core/tree/v4.13.0>. The complete license and upstream third-party notices are distributed in `node_modules/axe-core/LICENSE` and `node_modules/axe-core/LICENSE-3RD-PARTY.txt`.
- **Material Symbols**, provided through `@iconify-json/material-symbols`, licensed under the Apache License 2.0. Project information: <https://icon-sets.iconify.design/material-symbols/>.
- **@noble/ciphers 2.4.0**, licensed under the MIT License. Source: <https://github.com/paulmillr/noble-ciphers>.
- **@node-rs/argon2 2.1.0**, an MIT-licensed Node-API binding to the RustCrypto Argon2 implementation, used for the Linux vault passphrase fallback. Source: <https://github.com/napi-rs/node-rs>.
- **@scure/bip39 2.4.0**, licensed under the MIT License. Source: <https://github.com/paulmillr/scure-bip39>.
- **@solana/kit 8.1.0** and its `@solana/*` modules, licensed under the MIT License. Source: <https://github.com/anza-xyz/kit>.
- **@wallet-standard/core 1.1.2** and **@wallet-standard/features 1.1.1**, licensed under the Apache License 2.0. Source: <https://github.com/wallet-standard/wallet-standard>.
- **micro-key-producer 0.10.0**, licensed under the MIT License. Source: <https://github.com/paulmillr/micro-key-producer>.
- **TronWeb 6.5.0**, licensed under the MIT License. Source: <https://github.com/tronprotocol/tronweb>.
- **viem 2.56.0**, licensed under the MIT License. Source: <https://github.com/wevm/viem>.

The production dependency tree was reviewed for this wallet implementation. It contains no WalletConnect or Reown package. The wallet implementation does not use hosted custody, relays, proprietary wallet SDKs, or commercial-threshold dependencies.

Other bundled dependencies retain the licenses declared by their packages, including permissive and weak-copyleft terms. Their package metadata, license files, and the exact resolved versions in `package-lock.json` remain the authoritative dependency-level record.
