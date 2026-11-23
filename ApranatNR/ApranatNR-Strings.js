// ----------------------------------------------------------------------------
// ApranatNR-Strings.js - dialog messages in English and Japanese.
//
// Messages may contain format() specifiers (%s, %d, %.0f); both languages
// must use the same specifiers in the same order (checked by the tests).
// Console log messages stay in English.
// ----------------------------------------------------------------------------

const ANR_LANGUAGES = [ "en", "ja" ];
const ANR_LANGUAGE_NAMES = { en: "English", ja: "日本語" };

const ANR_STRINGS = {
   en: {
      add: "Add",
      removeSelected: "Remove selected",
      clear: "Clear",
      browseTip: "<p>Browse...</p>",
      clearTip: "<p>Clear</p>",
      language: "Language:",
      info: "<p><b>%s %s</b> &mdash; preprocessing noise countermeasures by apranat that WBPP does not have<br/>" +
            "① Before registration: drunk (RTN) pixel correction → cool file correction / ② After registration: Cosmicut</p>",
      tabStageA: "① Before registration (drunk pixels / cool file)",
      tabStageB: "② After registration (Cosmicut)",
      overwrite: "Overwrite existing files",
      overwriteTip: "<p>When off, files are saved under new names ending in _1, _2, ...</p>",
      close: "Close",
      lightsGroup: "Light frames (dark/flat calibrated, not registered, not debayered)",
      cfaLabel: "Sensor pattern:",
      cfaAuto: "Automatic (BAYERPAT / CFA property)",
      cfaMono: "Monochrome (or RGB)",
      cfaBayer: "Bayer CFA (neighbors of the same color)",
      cfaTip: "<p>In undebayered color camera images, the neighbor median uses only pixels of the same color (every second pixel).</p>",
      darksGroup: "Dark frames (individual files, same settings as the lights)",
      rtnGroup: "Drunk (RTN) pixel correction (software pixel mapping)",
      defectMapLabel: "Existing defect map:",
      defectMapTip: "<p>An rtn_defect_map.xisf made earlier; the dark frame analysis is skipped.</p>",
      rtnRatioLabel: "Fluctuation ratio threshold:",
      rtnRatioTip: "<p>A pixel is a drunk pixel when the fluctuation (standard deviation) of its dark sequence exceeds this factor times " +
                   "the fluctuation expected at its dark level (read noise + dark current shot noise; the level is the pixel's lower quartile, " +
                   "without its jumps). Drunk pixels are replaced by the median of the surrounding pixels of the same color (default 4).</p>" +
                   "<p>Each pixel's highest and lowest value are left out, so one-off events such as cosmic rays are not detected. " +
                   "Pixels that are only bright (hot pixels with much dark current) are not detected either; " +
                   "dark subtraction and WBPP's cosmetic correction take care of them.</p>",
      protectStructures: "Protect stars and other structures (recommended)",
      rtnProtectTip: "<p>A pixel is not repaired when the replacement would change it by more than %.0f σ " +
                     "(the spread of the frame's same-color neighbors). A star's center is always brighter than its surroundings, " +
                     "so replacing it makes the star dimmer; without guiding or dithering the same star stays on the same defect " +
                     "in every frame and the loss remains in the master. Drunk pixel jumps normally stay within this limit, " +
                     "so the background correction hardly changes.</p>" +
                     "<p>Defect pixels on which the unregistered stack of the uncorrected lights shows a star are not repaired either: " +
                     "the pixel is brighter than its same-color neighbors by more than %.0f σ, or its 8 adjacent pixels are brighter " +
                     "together by more than %.0f σ (a star's footprint). A faint star buried in the noise of each frame stands out " +
                     "in the stack when it stays on the same pixels; the trace of a drunk pixel covers one pixel, " +
                     "so the adjacent pixels stay normal.</p>" +
                     "<p>Large one-off outliers on defects (cosmic rays) are also left to the pixel rejection of WBPP or Cosmicut. " +
                     "When off, defect pixels are always replaced, as in the original article; " +
                     "also turn it off when the defect map contains hot pixels.</p>",
      coolProtectTip: "<p>Only isolated dark points where the surrounding same-color pixels are flat are corrected. " +
                      "Star images and nebula edges are excluded, because shot noise and brightness changes make pixels there look dark.</p>" +
                      "<p>When off, the original article's criterion is used (no distinction of structures).</p>",
      coolGroup: "Cool file correction",
      coolSigmaLabel: "Detection threshold (σ):",
      coolSigmaTip: "<p>In the unregistered average stack, pixels darker than the median of their same-color neighbors by k×σ or more " +
                    "are cool pixels (default 5). Around 3 the threshold starts to pick up the tail of the stack's own noise. " +
                    "0 corresponds to the article's \"threshold zero\" (every pixel darker than its neighbors is lifted).</p>",
      suffixLabel: "Output file suffix:",
      outputGroup: "Output",
      outputDirLabel: "Output folder:",
      outputDirTipA: "<p>When empty, an ApranatNR subfolder is created in the folder of the first light frame.</p>",
      runStageA: "① Run",
      doneStageA: "<p>%d corrected frames written.</p>" +
                  "<p>Next: debayer and register the corrected frames with WBPP (without calibration) or StarAlignment, " +
                  "then add the registered frames to tab ②.</p>",
      registeredGroup: "Registered frames",
      excludeZero: "Treat pixels at or below 0 as \"no data\" (registration borders)",
      excludeZeroTip: "<p>The same as Clip low range in ImageIntegration. It prevents darkened borders when the field drifts without guiding.</p>" +
                      "<p>Note: with data whose background was truncated to 0 by the calibration (no pedestal), pixels at 0 are excluded too " +
                      "and the background is biased slightly upward. Turn it off in that case.</p>",
      saveMax: "Also save the map of rejected maximum values (to check cosmic ray hits)",
      cosmicutGroup: "Cosmicut: (sum − max) ÷ (N − 1)",
      outputDirTipB: "<p>When empty, an ApranatNR subfolder is created in the folder of the first frame.</p>",
      runStageB: "② Run Cosmicut",
      doneStageB: "<p>Cosmicut master written:</p><p>%s</p>"
   },
   ja: {
      add: "追加",
      removeSelected: "選択を削除",
      clear: "クリア",
      browseTip: "<p>参照...</p>",
      clearTip: "<p>クリア</p>",
      language: "Language:",
      info: "<p><b>%s %s</b> &mdash; あぷらなーと氏のノイズ対策前処理（WBPPに無い処理）<br/>" +
            "① 位置合わせ前: 酩酊ピクセル補正 → クールファイル補正法 / ② 位置合わせ後: コスミカット法</p>",
      tabStageA: "① 位置合わせ前（酩酊ピクセル / クールファイル）",
      tabStageB: "② 位置合わせ後（コスミカット）",
      overwrite: "既存ファイルを上書きする",
      overwriteTip: "<p>オフの場合は _1, _2 ... を付けた別名で保存します。</p>",
      close: "閉じる",
      lightsGroup: "ライトフレーム（ダーク/フラット補正済み・位置合わせ前・ディベイヤー前）",
      cfaLabel: "センサー配列:",
      cfaAuto: "自動判定（BAYERPAT / CFAプロパティ）",
      cfaMono: "モノクロ（または RGB）",
      cfaBayer: "Bayer CFA（同色画素で近傍計算）",
      cfaTip: "<p>カラーカメラの未ディベイヤー画像では、同じ色の画素（2画素おき）だけで近傍メディアンを計算します。</p>",
      darksGroup: "ダークフレーム（個別ファイル・ライトと同設定）",
      rtnGroup: "酩酊ピクセル補正（ソフトウェア・ピクセルマッピング）",
      defectMapLabel: "既存の欠陥マップ:",
      defectMapTip: "<p>以前に作成した rtn_defect_map.xisf を指定するとダーク解析を省略します。</p>",
      rtnRatioLabel: "標準偏差しきい値:",
      rtnRatioTip: "<p>ダーク時系列の揺らぎ（標準偏差）が「その画素のダーク値（跳ねた分を除いた下側の値）で期待される揺らぎ" +
                   "（読み出しノイズ＋暗電流のショットノイズ） × この倍率」を超える画素を酩酊ピクセルとし、" +
                   "同色の周辺画素のメディアンで置き換えます（既定 4）。</p>" +
                   "<p>各画素の最大値と最小値を1枚ずつ除いて計算するので、宇宙線など1枚だけの突発値では検出しません。" +
                   "ダーク値が高いだけの画素（暗電流の多いホットピクセル）も対象外で、それはダーク減算と WBPP のコスメティック補正が担当します。</p>",
      protectStructures: "星・星雲などの構造を保護する（推奨）",
      rtnProtectTip: "<p>置き換えると値が %.0fσ（そのフレームの同色近傍とのばらつき）を超えて変わる画素は補正しません。" +
                     "星の中心は周辺の画素より必ず明るいので、置き換えると暗くなります。ガイドなし・ディザーなしで同じ星が同じ欠陥画素に" +
                     "乗り続けると、全フレームで同じだけ暗くなり、マスターに残ります。酩酊ピクセルの揺れは通常この範囲に収まるため、" +
                     "背景の補正はほぼ変わりません。</p>" +
                     "<p>さらに、補正前のライトを位置合わせせずに重ねた画像で星が乗っている欠陥画素も補正しません。" +
                     "判定は、その画素が同色近傍より %.0fσ を超えて明るいか、隣の8画素がまとめて %.0fσ を超えて明るい（星の広がり）かです。" +
                     "1枚ではノイズに埋もれる淡い星も、同じ画素に乗り続けていれば重ねた画像では浮き出ます。" +
                     "酩酊ピクセルの跡は1画素だけなので、隣の画素は明るくなりません。</p>" +
                     "<p>欠陥上の大きな一時的な外れ値（宇宙線など）も残し、WBPP やコスミカットのピクセル棄却に任せます。" +
                     "オフにすると元記事どおり、欠陥画素を常に置き換えます。ホットピクセルを含む欠陥マップを使う場合もオフにしてください。</p>",
      coolProtectTip: "<p>周辺の同色画素が平坦な場所の「孤立した暗い点」だけを補正します。" +
                      "星の像や星雲の縁では、ショットノイズや明るさの変化で暗く見える画素を誤検出するため除外します。</p>" +
                      "<p>オフにすると元記事どおりの判定（構造を区別しない）になります。</p>",
      coolGroup: "クールファイル補正法",
      coolSigmaLabel: "検出しきい値 (σ):",
      coolSigmaTip: "<p>位置合わせ無しの加算平均画像で、同色近傍メディアンより k×σ 以上暗い画素をクールピクセルとします（既定 5）。" +
                    "3 程度まで下げると、スタック自身のノイズの裾まで拾い始めます。" +
                    "0 にすると元記事の「しきい値ゼロ」相当（近傍より暗い画素をすべて持ち上げる）になります。</p>",
      suffixLabel: "出力ファイル接尾辞:",
      outputGroup: "出力",
      outputDirLabel: "出力フォルダ:",
      outputDirTipA: "<p>空欄の場合は最初のライトと同じフォルダに ApranatNR サブフォルダを作成します。</p>",
      runStageA: "① 実行",
      doneStageA: "<p>%d 枚の補正済みフレームを書き出しました。</p>" +
                  "<p>次の手順: 補正済みフレームを WBPP（キャリブレーションなし）または StarAlignment で" +
                  "ディベイヤー・位置合わせし、registered フレームを ② タブに追加してください。</p>",
      registeredGroup: "位置合わせ済みフレーム（registered）",
      excludeZero: "値が 0 以下の画素を「データなし」として除外（位置合わせで生じた枠）",
      excludeZeroTip: "<p>ImageIntegration の Clip low range と同じ扱いです。ノータッチガイドで画角が流れた場合の縁の暗化を防ぎます。</p>" +
                      "<p>注意: キャリブレーションで背景が 0 に切り詰められている（ペデスタル無し）データでは、" +
                      "0 の画素も除外されて背景がわずかに明るく偏ります。その場合はオフにしてください。</p>",
      saveMax: "棄却された最大値マップも保存（宇宙線ヒットの確認用）",
      cosmicutGroup: "コスミカット法: (加算 − 比較明) ÷ (N − 1)",
      outputDirTipB: "<p>空欄の場合は最初のフレームと同じフォルダに ApranatNR サブフォルダを作成します。</p>",
      runStageB: "② コスミカット実行",
      doneStageB: "<p>コスミカット・マスターを書き出しました:</p><p>%s</p>"
   }
};

// the dialog's language (user interface state, kept by the script settings)
const anrLanguageState = { current: "en" };

function anrLanguage()
{
   return anrLanguageState.current;
}

/** Selects the dialog language; returns false (and keeps the current one) for an unknown language. */
function anrSetLanguage( language )
{
   if ( ANR_LANGUAGES.indexOf( language ) < 0 )
      return false;
   anrLanguageState.current = language;
   return true;
}

/** Message for `key` in the current language, else in English, else the key itself. */
function anrText( key )
{
   const table = ANR_STRINGS[ anrLanguageState.current ];
   if ( table && table[ key ] !== undefined )
      return table[ key ];
   return ( ANR_STRINGS.en[ key ] !== undefined ) ? ANR_STRINGS.en[ key ] : key;
}

if ( typeof module !== "undefined" && module.exports )
   module.exports = { ANR_LANGUAGES, ANR_LANGUAGE_NAMES, ANR_STRINGS, anrLanguage, anrSetLanguage, anrText };
