# alpha15 固定数値エンジンのソース・配布・再リンク記録

確認日: 2026-10-15。対象はサーバー側 `gmp-wasm@1.3.2` の固定成果物である。Windows 11 の現プロジェクトに原ソース、権利表示、再構築手順を保存した。OSツールの導入、環境設定変更、公開、外部へのプロジェクト送信は実施していない。

## 固定したものと確認範囲

機械可読な取得元・サイズ・SHA256・npm integrity は [SOURCES.json](../../packages/automation/vendor/math-engine/SOURCES.json) に記録する。[verify-sources.mjs](../../packages/automation/vendor/math-engine/source/verify-sources.mjs) はNode標準機能だけで固定ファイルを照合する。

| 項目 | 確認した値・根拠 |
| --- | --- |
| npm | `gmp-wasm@1.3.2`、公式registryの `dist.integrity` と保存tgzのSHA512が一致 |
| 上流ソース | `Daninet/gmp-wasm` commit `4e372e5a3c4a65f871e1bcaab63c78b29dc80ff8`。npmの `gitHead` と一致。公式commit archiveを保存 |
| ソース対応 | npmとcommit archiveの共有38ファイルはbyte一致。生成物 `dist/` と型出力、git側だけのlockfile等は別に扱う |
| 配布bundle | npm `package/dist/index.umd.js` とvendor `gmp-wasm-1.3.2/index.cjs` はbyte一致。SHA256 `76af404a6521699a9f2a0dd3fc34a48368b470cc5044e1fa8e5e480a3deae55a` |
| 埋込みWASM | 522561 bytes、SHA256 `ca1f8def552c30d44c67247d0a959bbf17e022d1e5999889ce4b9922f5211909`。npm bundleから抽出した値 |
| GMP | 6.3.0。[固定commitのbuild-gmp.sh](https://raw.githubusercontent.com/Daninet/gmp-wasm/4e372e5a3c4a65f871e1bcaab63c78b29dc80ff8/binding/build-gmp.sh) がGNU公式の6.3.0 archiveを取得。runtimeのversion APIを読めたという意味ではない |
| MPFR | 4.2.1。固定Dockerfileのarchive指定、および現artifactの `mpfr_get_version()` が一致 |
| ツール系列 | Dockerfileは `emscripten/emsdk:3.1.58`。上流CIはUbuntu runnerとNode `20.x`。上流lockfileがJS依存の版・integrityを指定 |
| submodule | 当該Git treeにgitlinkはない。GMPソースは `.gitignore` 対象で、build scriptが取得・展開するため別途GNU archiveを保存 |

原ソースは [source/](../../packages/automation/vendor/math-engine/source/)、ライセンスと著作者表示は [licenses/NOTICE.md](../../packages/automation/vendor/math-engine/licenses/NOTICE.md) にある。GMP/MPFRの署名ファイルも保存したが、現PATHにgpgがなく署名検証は実施していない。SHA照合・npm SRI照合と署名検証は別である。

## 対応ソースと上流の変更

上流commit archiveにはC bindingの `binding/src/entry.c`、TypeScript wrapper全体、3つのDockerfile、3つのbuild script、`scripts/toBase64.js`、Rollup設定、`package-lock.json`、GMP調整ヘッダーが入る。GNU配布のGMP 6.3.0/MPFR 4.2.1 archives、bundled inflate/helperのfflate 0.7.3/tslib 2.4.0 npm archivesも固定した。fflate/tslibのSHA512は上流lockfileに一致する。

GMPには上流recipe由来の変更がある。`configure` の `abilist="standard"` に `longlong` ABI設定を追記し、`mpn/generic/gmp-mparam.h` を固定commit内のファイルに差し替える。`longlong.h` と `time.c` も上流archiveに残るが、現Dockerfileはその差し替えを実行していない。MPFRへの追加パッチ適用処理は当該recipeにはない。原GNU archiveと、変更を行うrecipeの両方を保存している。

| 段階 | 主要設定（完全な原文はcommit archive内） |
| --- | --- |
| GMP | `-O3 -Oz -fno-rtti -fno-exceptions -msimd128 -msse2`、`-DNO_ASM`、`MPN_PATH=generic`、`ABI=longlong`、`--host none --with-readline=no --enable-fft=yes --disable-cxx --enable-alloca=malloc-notreentrant` |
| MPFR | `-O3 -Oz -fno-rtti -fno-exceptions`、`-DNO_ASM`、`--host none --enable-assert=none --disable-thread-safe --disable-float128 --disable-decimal-float --enable-gmp-internals --with-gmp=/builder/dist` |
| binding | `-O3 -Oz -flto -fno-rtti -fno-exceptions`。full buildは `GMP_WASM_FULL_LIB` と `-lgmp -lmpfr`。`ENVIRONMENT=web,worker,node`、memory growth、modularize、standalone WASM、undefined-symbol error、filesystem無効、`--no-entry` |
| JS | `toBase64.js` がWASMをfflateで圧縮し、固定Rollup設定でUMD/ESMを生成。配布対象はfullの `dist/index.umd.js` |

## 再構築手順

事前に利用可能なDockerのLinuxコンテナー環境、POSIX shell、Node/npm、tarが必要である。今回のPCではDockerとemccを確認できず、ツール導入は禁止されているため以下のビルドは未実行である。手順ファイル自体の構文・固定入力の照合と、ライブラリの再コンパイル成功は区別する。

プロジェクトルートから固定入力だけを検査する:

```text
node packages/automation/vendor/math-engine/source/verify-sources.mjs
```

OS付属tarも利用できる場合、npmとcommitの共有ファイルおよびvendor runtimeの一致を再照合できる:

```text
node packages/automation/vendor/math-engine/source/compare-source.mjs
```

上記の前提がある環境では、次のrecipeが無視対象 `.local/math-engine-relink-*` 内だけに第三者ソースを展開して構築する。NEXUSのcheckoutや実行中artifactを置き換えない:

```text
sh packages/automation/vendor/math-engine/source/rebuild.sh
```

recipeは、GMP archiveを `binding/gmp/src` へ**先に平置き展開**してからtar本体を置く。上流build scriptはtarが既存だと展開も省略するため、コピーだけでは不足する。MPFR Dockerfileの `RUN wget` 部分は、保存済みarchiveの `COPY` と展開に置換する。この取得方法だけの変更をrecipeに明記した。GMP→MPFR→bindingの順に元Dockerfileで構築し、上流lockを使う `npm ci --ignore-scripts --no-audit --no-fund` とwrapper生成を実行する。npm cacheも作業用 `.local` 内に限定する。

Docker image、aptパッケージ、JS build依存の取得にはネットワークまたは既存キャッシュが必要である。この保存物だけで全ツールを含むoffline buildが完成したという意味ではない。上流CIの可変runner、Nodeのpatch版、Docker imageの当時digest、aptの当時版までの証明はなく、同一byte再現も未確認である。既存の配布bundleを再生成したと主張しない。

## 変更したライブラリとの再リンク

ライブラリを変更する受領者は、展開したGMP/MPFR/bindingまたはwrapperを変更し、その変更を記録して同じ段階を再構築する。再構築した `dist/index.umd.js` を `packages/automation/vendor/math-engine/gmp-wasm-1.3.2/index.cjs` にコピーする。WASM単体の差し替えでは、圧縮WASMを内包するbundleは変わらない。

私用のNEXUSソースbuildでは、生成bundle/WASMのSHA256を求め、次を生成物に対応させて更新する:

1. [scratch-mpfr-loader.ts](../../packages/automation/src/scratch-mpfr-loader.ts) の `SCRATCH_MPFR_ARTIFACT.bundleSha256` と記録用 `wasmSha256`。MPFR version文字列も変更した場合は `mpfrVersion` を合わせる。
2. [artifact.json](../../packages/automation/vendor/math-engine/gmp-wasm-1.3.2/artifact.json) の生成物hash・版・変更情報。npm元bundleを使っているという既存 `modified:false` の説明も変更する。
3. 自身の変更ソース、ビルド設定、権利表示と配布時の対応ソース情報。

通常のアプリ型検査・build・数値エンジンの適合試験を実行し、私用buildを再起動する。hash/versionの固定照合は既定の安全な起動条件として維持する。検査を迂回するoverrideや秘密の署名鍵は必要としない。hashを更新せずbundleだけ替えると `ScratchMpfrArtifactHashMismatch` になり、版だけ変えると `ScratchMpfrArtifactVersionMismatch` になる。この文書の追加は製品loaderを変更しない。

互換interfaceでライブラリを変更できる権利と、その変更がNEXUSの数学仕様に合格する保証は別である。変更後の数値仕様は受領者のbuildで改めて検証する。今回、改変ライブラリによる再リンクの実演は実施していない。

## 外部配布に必要な扱いと未完了の確認

gmp-wasmはLGPL-3.0-only、MPFRはLGPL-3.0-or-later、GMPのlibraryはLGPL-3.0-or-laterまたはGPL-2.0-or-laterを選べる。GMPソース内の別ライセンスを持つtool/testも原表示を保持する。fflateのMIT、tslibの0BSD、Emscripten/musl/compiler-rtの原文も同梱した。根拠は保存した各原文と [GNU GMPの配布条件](https://gmplib.org/manual/Copying)、[MPFR 4.2.1の公式配布](https://www.mpfr.org/mpfr-4.2.1/)、[gmp-wasmの固定LICENSE](https://raw.githubusercontent.com/Daninet/gmp-wasm/4e372e5a3c4a65f871e1bcaab63c78b29dc80ff8/LICENSE) である。

外部にbundle/Combined Workを渡す際は、各著作権・無保証表示とGPLv3/LGPLv3全文を同梱し、適用される対応ソース、再結合可能なapplication material、手順を受領者が利用できる形で提供する。LGPLv3 §4のlibrary変更およびそのdebug目的のreverse engineeringを配布条件で妨げない。製品として必要になるinstallation informationがあれば同じ提供物に含める。この作業はプロジェクト全体の新たな利用許諾や契約条項を決定しない。

現時点ではrootのプロジェクト全体LICENSEを確認できず、外部配布契約でのapplication material利用権、実際の配布物へのsource/notice同梱、改変後のrelink実演、署名検証、ツール環境を固定した再buildは未完了である。したがって `distributionComplianceCertified` と `exactBinaryRebuildVerified` はfalseと記録する。これはローカル実装や試験を止める判断ではなく、将来の外部配布で確認すべき具体的な未完了項目である。

## 今回のファイル検証

固定34ファイルのサイズ・SHA256とnpm SRI 3件、共有38ファイルとruntime bundleのbyte一致を再検査した。検査用2つのmjsはNode構文検査とignore解除した対象ESLintで確認する。rebuild recipe内のNode部分2件の構文と、固定MPFR Dockerfileに対する取得方法置換は入力原文へ適用して確認した。POSIX shell本体の構文検査ツールと実Docker環境はこのホストで見つからず、その部分の実行成功は主張しない。

license/source配下の局所 `.gitattributes` は、原文・署名・archive・recipeをcheckout時にも同じbyteで保つ。license内の元からあるCRLFは `cr-at-eol` として識別する。原文を改変しないため、Emscripten LICENSEの60行目とGMP `COPYING.LESSERv3` の13/114行目に上流由来の行末空白を保持する。また、Emscripten LICENSEの102行目とtslib `CopyrightNotice.txt` の15行目の空の終端行も保持する。これら5件だけのpath/行/hashは `SOURCES.json.originalLicenseWhitespaceExceptions` に記録し、一般製品コードのwhitespace許容へ広げない。
