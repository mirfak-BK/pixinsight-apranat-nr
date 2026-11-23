# ApranatNR

[English](README.md)

あぷらなーと氏が考案した、WBPP に無いノイズ対策の前処理を PixInsight で行うスクリプトです。[あぷらなーと氏のブログ](https://apranat.exblog.jp/)で公開された手法を、独自に実装したものです。

| 手法 | 内容 | 元記事 |
|---|---|---|
| 酩酊ピクセル補正 | 個別ダークから、フレームごとに2段階に揺れる画素を見つけ、各ライトで同じ色の周りの画素の中央値に置き換える | [32142709](https://apranat.exblog.jp/32142709/) |
| クールファイル補正法 | 位置合わせなしの加算平均で周りより暗い画素を見つけ、全フレームで持ち上げる | [28135658](https://apranat.exblog.jp/28135658/) |
| コスミカット法 | 位置合わせ後、画素ごとに一番明るい1枚を除いて平均する：(合計 − 最大値) ÷ (枚数 − 1) | [31257871](https://apranat.exblog.jp/31257871/) |

## 必要なもの

- PixInsight 1.9.6 以降
- WBPP に組み込む場合は WBPP 3.2 以降（WBPP 本体は変更しません）

## 使い方

- **単体スクリプト**：`ApranatNR.js` を実行します（Script > Execute Script File...）。① タブでキャリブレーション済み・ディベイヤー前のライトを補正し、② タブで位置合わせ済みフレームからコスミカットのマスターを作ります。
- **WBPP に組み込む**：WBPP の Pipeline タブで「Pipeline builder」を有効にし、`ApranatNR-WBPP-Builder.js` を選びます。キャリブレーションの直後に ApranatNR の工程が入ります。設定は同じフォルダの `ApranatNR-WBPP-Settings.json` です。
- 画面は最初は英語です。画面下の「Language」で「日本語」を選ぶと切り替わり、次回からも日本語で開きます。

詳しい説明：[ApranatNR-Guide.html](ApranatNR-Guide.html)（日本語）、[ApranatNR-Guide-en.html](ApranatNR-Guide-en.html)（英語）

## 特長

- 酩酊ピクセルの判定はダークの物理にもとづきます。最大・最小を除いた揺らぎが、各画素の下側の値で期待される揺らぎ（読み出しノイズ＋暗電流のショットノイズ）の4倍を超えた画素を酩酊ピクセルとします。ホットピクセルを誤って判定しません。
- 星の保護：置き換えで5σを超えて変わる画素と、補正前のライトを重ねた画像で星が乗っている画素（画素そのものが5σ超、または隣の画素に3σの広がり）は補正しません。ディザーなしのデータでも、欠陥画素に乗った淡い星を暗くしません。
- ZWO ASI533MC Pro のデータで、WBPP だけの場合より背景ノイズが 1.2〜1.7% 下がり、星の明るさは変わりませんでした（説明書の9章）。

## テスト

```bash
node --test tests/*.test.js          # 単体テスト（Node）
tests/wbpp-e2e/run.sh                # 実際の WBPP を使う端から端までのテスト（別の PixInsight を自動実行）
```

ソースを直したら `node tools/build-wbpp-builder.js` で WBPP 用のビルダーを作り直してください。

## クレジット

手法の考案：あぷらなーと氏（apranat.exblog.jp）。WBPP は PixInsight のスクリプトで、ApranatNR は公式の Pipeline builder の仕組みで連携するだけです。
