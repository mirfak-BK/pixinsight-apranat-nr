# FlatSmooth

[English](README.md)

マスターフラットの画素ごとのノイズを調べ、CFAの色ごとに平滑化するPixInsightスクリプトです。

**目的:** 枚数が少ない、または暗すぎるフラットで作ったマスターフラットには、画素ごとのノイズが残ります。すべてのライトはこれで割られるので、どのライトにも同じ模様がセンサーの同じ位置に乗ります。ディザリングなしでフレーム間に星野がドリフトすると、位置合わせでその模様が引き伸ばされて斜めの縞になります。これが**縮緬ノイズ**です。実例として、テストに使用したCanon 6Dのデータではフラットが空の背景より暗く、マスターフラットに6〜9%の画素ノイズがありました。これが縮緬ノイズの原因で、フラットを平滑化すると縞が消えました（細かいノイズ −35%、星の明るさは変わらず、大きな明るさムラの補正は0.04%以内で一致）。

## できること

- **調べる:** 色ごと（ベイヤー配列のR・G・G・Bの位置、またはモノクロ／RGBフラットの各チャンネル）に、画素ノイズの割合を測ります。
- **平滑化:** 外れ値の画素（ホット、デッド、数値でないもの）を同じ色の周囲8画素の中央値に置き換えてから、色ごとにボックス平均を3回かけます（ほぼガウシアン）。色は混ざりません。
- **半径:** 自動（ノイズを目標値まで下げる最小の半径。目標の初期値は0.3%）または指定。自動では、ノイズの少ないフラットには手を加えません。
- **出力:** `<名前>_smooth.xisf`。FITSキーワードとプロパティ（IMAGETYP = Master Flat、ベイヤー配列）をすべて引き継ぎ、HISTORYを追記するので、WBPPはマスターフラットとして読み込みます。WBPPのマスターに入っているリジェクションマップはコピーしません。

注意: 平滑化の大きさより小さい画素ごとの感度差（PRNU）やゴミの影は補正されなくなります。ノイズの多いフラットではどのみち測れない情報です。十分明るく20枚以上撮った良いフラットなら、このツールは不要です。

## 使い方

`FlatSmooth.js` を実行し（Script > Execute Script File...）、マスターフラットを選んで「調べる」、続いて「平滑化して保存」を押します。WBPPでは個々のフラットを外し、代わりに `_smooth.xisf` を入れてください。

**WBPPの中で自動実行：** ApranatNR のパイプラインビルダー（`../ApranatNR/ApranatNR-WBPP-Builder.js`）を使うと、WBPPが作ったマスターフラット（または自分で入れたマスターフラット）に FlatSmooth をかけ、`<出力>/flatsmooth/` に書いた平滑化版でライトを較正します。WBPPのマスターフラットとファイルリストは変わりません。設定は `ApranatNR-WBPP-Settings.json` の `flatSmoothEnabled`、`flatSmoothRadius`（0 = 自動）、`flatSmoothTargetPercent` です。FlatSmooth だけを使うときは、そこで `rtnEnabled` と `coolEnabled` を false にしてください。

無人実行（ヘッドレスのPixInsight）:

```text
PixInsight -n --automation-mode --force-exit -r="FlatSmooth.js,--out=<xisf>[,--target=<%>|--radius=<n>][,--cfa=auto|on|off][,--check][,--lang=en|ja],<マスターフラット>"
```

結果の要約は `<out>.json`、エラーは `<out>.error.txt` に書き出します。`tests/run-headless.sh <マスターフラット> <out.xisf> [オプション]` で同じことができます。

## 計測の仕組み

画素ノイズと自動半径の計算方法、フラットのノイズが縮緬ノイズになる理由は [ノイズ計測の解説](../docs/NoiseMeasurement-Guide.html#flat)（[English](../docs/NoiseMeasurement-Guide-en.html#flat)）にあります。

## テスト

```bash
node --test tests/*.test.js
```

`tests/FlatSmooth-DialogTest.js` は、ヘッドレスのPixInsightで両方の言語のダイアログを組み立てます。
