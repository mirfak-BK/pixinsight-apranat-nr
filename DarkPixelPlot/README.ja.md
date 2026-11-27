# DarkPixelPlot

[English](README.md)

個別のダークフレームから、画素ごとの「輝度中央値」と「輝度揺らぎ（標準偏差）」のグラフを作る PixInsight のスクリプトです。[あぷらなーと氏の酩酊ピクセルの分析](https://apranat.exblog.jp/32142709/)と同じ形式で、通常の画素・ホットピクセル・酩酊ピクセルがはっきり分かれて見えます。

- **(a) 全体**（中央値の軸は対数）と **(b) 通常の画素の付近の拡大**（中央値の軸は等間隔）の2枚を描きます。揺らぎの軸は対数で、あぷらなーと氏のグラフと同じ 10¹〜10⁴ に固定することもできます。
- 最大・最小を除いた揺らぎが、各画素の下側の値で期待される揺らぎ（読み出しノイズ＋暗電流のショットノイズ）の4倍を超えた画素をオレンジで示します。[ApranatNR](../ApranatNR/README.ja.md) と同じ判定です。ApranatNR の欠陥マップを表示することもできます。
- 典型的な揺らぎと判定の目安を、この式の曲線で描き、式の数値をグラフの下に書きます。
- PNG と、数値のまとめ（JSON）を書き出します。
- FITS・XISF のほか、CR2 などカメラの RAW ファイルもディベイヤー前の値のまま読み込みます。
- 画面とグラフは英語（既定）と日本語に対応しています。画面下の「Language」で切り替えます。

## 使い方

`DarkPixelPlot.js` を実行し（Script > Execute Script File...）、同じ露出・ゲイン・温度の個別ダークを8枚以上（20枚以上を推奨）追加して「グラフを作成」を押します。

自動実行（画面なしの PixInsight）：

```text
PixInsight -n --automation-mode --force-exit -r="DarkPixelPlot.js,--out=<png>[,--map=<xisf>][,--title=<題名>][,--ratio=<倍率>][,--yaxis=apranat|auto][,--lang=en|ja],<ダーク1>,<ダーク2>,..."
```

`tests/run-headless.sh <ダークのフォルダ> <ファイル名の正規表現> <出力.png> [欠陥マップ] [追加オプション]` でも実行できます。エラーは `<出力>.png.error.txt` に書き出します。

## 計測の仕組み

グラフの軸と典型的な揺れの曲線の意味は [ノイズ計測の解説](../docs/NoiseMeasurement-Guide.html#dark)（[English](../docs/NoiseMeasurement-Guide-en.html#dark)）にあります。

## テスト

```bash
node --test tests/*.test.js
```

## クレジット

グラフの形式は、あぷらなーと氏の分析（apranat.exblog.jp）にもとづきます。
