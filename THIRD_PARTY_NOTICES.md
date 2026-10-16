# Third-party notices

Hronaut depends on and bundles third-party open-source software. Each dependency remains under its own license; the Subscription and Trial License for Hronaut does not replace those terms. Complete dependency names, versions, and integrity hashes are recorded in `package-lock.json`.

Notable code and assets compiled into the desktop application include:

- **axe-core 4.13.0**, Copyright Deque Systems, Inc. and contributors, licensed under the Mozilla Public License 2.0. Source: <https://github.com/dequelabs/axe-core/tree/v4.13.0>. The complete license and upstream third-party notices are distributed in `node_modules/axe-core/LICENSE` and `node_modules/axe-core/LICENSE-3RD-PARTY.txt`.
- **Mediabunny 1.42.0**, licensed under the Mozilla Public License 2.0, used to encode and mux local WebM video exports. Source: <https://github.com/Vanilagy/mediabunny/tree/v1.42.0>. The complete license is distributed in `node_modules/mediabunny/LICENSE`.
- **Geist Sans and Geist Mono 1.7.2** (variable fonts), Copyright (c) 2023 Vercel, in collaboration with basement.studio, licensed under the SIL Open Font License 1.1, used for Hronaut's interface and code text. Source: <https://github.com/vercel/geist-font>. The complete license follows at the end of this file.
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

## Geist font license

```text
Copyright (c) 2023 Vercel, in collaboration with basement.studio

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION AND CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
