# あぷらなーと氏のノイズ対策を PixInsight で使うスクリプト

[English](README.md)

あぷらなーと氏（[apranat.exblog.jp](https://apranat.exblog.jp/)）が公開した前処理のノイズ対策を、PixInsight で使えるようにした2つのスクリプトです。公開された手法を、独自に実装したものです。3つ目の FlatSmooth は、関連して作った独自のツールです（あぷらなーと氏の手法ではありません）。

| スクリプト | 内容 |
|---|---|
| [ApranatNR](ApranatNR/README.ja.md) | 酩酊ピクセル補正（ソフトウェア・ピクセルマッピング）、クールファイル補正法、コスミカット法。単体でも、WBPP 公式の Pipeline builder を使って WBPP に組み込んでも動きます |
| [DarkPixelPlot](DarkPixelPlot/README.ja.md) | 個別ダークから画素ごとの輝度中央値と輝度揺らぎのグラフを作り、通常の画素・ホットピクセル・酩酊ピクセルを見分けます |
| [FlatSmooth](FlatSmooth/README.ja.md) | マスターフラットの画素ごとのノイズを調べ、CFAの色ごとに平滑化します。ノイズの多いフラットが原因の縮緬ノイズを防ぎます。ApranatNR のパイプラインビルダーで WBPP の中でも動きます |

どのスクリプトも画面は英語（既定）と日本語に対応しています。画面下の「Language」で切り替えます。

## 必要なもの

- PixInsight 1.9.6 以降
- ApranatNR を WBPP に組み込む場合は WBPP 3.2 以降（WBPP は同梱せず、変更もしません）

## インストール

1. このリポジトリをダウンロード（Code > Download ZIP）するか、clone します。
2. PixInsight のメニュー **Script > Execute Script File...** で実行します（`ApranatNR/ApranatNR.js`、`DarkPixelPlot/DarkPixelPlot.js`、`FlatSmooth/FlatSmooth.js`）。
3. メニューから起動したい場合は、**Script > Feature Scripts...** でこのフォルダを登録します。ApranatNR は Script > Preprocessing に、DarkPixelPlot と FlatSmooth は Script > Utilities に入ります。
4. WBPP に組み込む場合は、WBPP の Pipeline builder に `ApranatNR/ApranatNR-WBPP-Builder.js` を指定します（[ApranatNR の説明書](https://mirfak-bk.github.io/pixinsight-apranat-nr/ApranatNR/ApranatNR-Guide.html)を参照）。

## 説明書

- ApranatNR の説明書：[日本語](https://mirfak-bk.github.io/pixinsight-apranat-nr/ApranatNR/ApranatNR-Guide.html)、[英語](https://mirfak-bk.github.io/pixinsight-apranat-nr/ApranatNR/ApranatNR-Guide-en.html)
- ノイズ計測の解説（3つのツールがノイズをどう測るか、検証で仕上がりをどう比べたか）：[日本語](https://mirfak-bk.github.io/pixinsight-apranat-nr/docs/NoiseMeasurement-Guide.html)、[英語](https://mirfak-bk.github.io/pixinsight-apranat-nr/docs/NoiseMeasurement-Guide-en.html)
- [ApranatNR の README](ApranatNR/README.ja.md)、[DarkPixelPlot の README](DarkPixelPlot/README.ja.md)、[FlatSmooth の README](FlatSmooth/README.ja.md)

## テスト

単体テストは Node.js で実行します（各スクリプトのフォルダで `node --test tests/*.test.js`）。PixInsight が必要なテストは、画面なしの PixInsight を起動して実行します。詳しくは各 README を見てください。

## クレジットとライセンス

- ApranatNR と DarkPixelPlot の手法と分析の考案：あぷらなーと氏（apranat.exblog.jp）
- WBPP は PixInsight のスクリプトで、ApranatNR は WBPP の Pipeline builder の仕組みで連携するだけです。
- コード：MIT ライセンス（[LICENSE](LICENSE)）
