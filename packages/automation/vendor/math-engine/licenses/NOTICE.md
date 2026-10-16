# Math engine third-party notices

This directory accompanies the separate `gmp-wasm-1.3.2/index.cjs` runtime artifact. Its source inventory and original download URLs are in `../SOURCES.json`; unmodified upstream archives and the local rebuilding recipe are in `../source/`.

| Component | Copyright/attribution | Applicable library license and accompanying text |
| --- | --- | --- |
| gmp-wasm 1.3.2 | Dani Biro; original `AUTHORS` retained | LGPL-3.0-only; `gmp-wasm-1.3.2/LICENSE` and the GPLv3 text in `gmp-6.3.0/COPYINGv3` |
| GNU GMP 6.3.0 | Free Software Foundation and contributors; original `AUTHORS` retained | Library: LGPL-3.0-or-later OR GPL-2.0-or-later. Source tools/tests have their own notices, including GPLv3. All original `COPYING*` files are retained in `gmp-6.3.0/` and the complete source archive. |
| GNU MPFR 4.2.1 | Free Software Foundation, INRIA AriC/Caramba and contributors; original `AUTHORS` retained | LGPL-3.0-or-later; `mpfr-4.2.1/COPYING.LESSER` plus `COPYING` |
| fflate 0.7.3 (bundled inflate code) | Copyright (c) 2020 Arjun Barrett | MIT; `fflate-0.7.3/LICENSE` |
| tslib 2.4.0 (bundled helper code) | Copyright (c) Microsoft Corporation | 0BSD; original `tslib-2.4.0/LICENSE.txt` and `CopyrightNotice.txt` |
| Emscripten 3.1.58 runtime support | Emscripten authors, Node contributors, musl contributors, LLVM contributors | Original Emscripten MIT/NCSA notices, musl copyright/license inventory, and compiler-rt Apache-2.0 WITH LLVM-exception text are retained in this directory. This is a conservative notice set, not a per-symbol binary attribution claim. |

GMP is built with the upstream project's `configure` ABI adjustment and replacement `mpn/generic/gmp-mparam.h`. Those upstream modifications and their source are preserved in the fixed gmp-wasm commit archive. NEXUS has not edited the runtime bundle; it renames the npm UMD file to `.cjs` for Node interoperability. The collected rebuilding recipe, dated 2026-10-15, additionally substitutes a local, hash-verified MPFR input archive for the upstream Dockerfile's network download. This changes source transport, not the MPFR library files.

The LGPL/GPL and permissive notices apply to their respective components. Preserve these notices, copyright statements and warranty disclaimers whenever conveying the artifact. Source delivery and recombination/relinking information are documented in `../../../../../docs/design/alpha15-math-engine-distribution.md` (relative to this notice's directory).

The source inventory is not a claim that all requirements for a particular external binary distribution have been completed. Before such distribution, supply the applicable corresponding source and application/relinking material with recipient permissions that allow the relevant library modification and debugging, as described in the accompanying distribution document. No external distribution was performed by this collection task.
