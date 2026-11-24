// ----------------------------------------------------------------------------
// FlatSmooth-Strings.js - dialog and result texts in English and Japanese.
//
// Messages may contain format() specifiers (%s, %d, %.1f, %.2f, %.3f); both
// languages must use the same specifiers in the same order (checked by the
// tests). Console log messages stay in English.
// ----------------------------------------------------------------------------

const FS_LANGUAGES = [ "en", "ja" ];
const FS_LANGUAGE_NAMES = { en: "English", ja: "日本語" };

const FS_STRINGS = {
   en: {
      language: "Language:",
      imageFiles: "Image files",
      allFiles: "All files",
      info: "<p><b>%s %s</b> &mdash; removes the per-pixel noise of a master flat. A flat made from too few or too dim frames " +
            "stamps its noise on every light at the same sensor position; drift between the frames smears it into " +
            "diagonal streaks (walking noise). Smoothing within each CFA colour keeps the vignetting and dust shading.</p>",
      inputLabel: "Master flat:",
      inputTip: "<p>The master flat to check and smooth (XISF or FITS; a CFA master flat as WBPP makes it, or a mono/RGB flat).</p>",
      outputLabel: "Output file:",
      outputTip: "<p>When empty, &lt;name&gt;_smooth.xisf is written next to the master flat. " +
                 "All FITS keywords and properties are kept, so WBPP still recognizes it as a master flat.</p>",
      cfaLabel: "CFA (Bayer) mosaic:",
      cfaAuto: "Automatic (from the file)",
      cfaOn: "Yes: smooth each colour separately",
      cfaOff: "No: smooth each channel as a whole",
      cfaTip: "<p>A master flat of a colour (OSC/DSLR) camera is a Bayer mosaic: each of the four colour positions is smoothed " +
              "separately so that colours never mix. Automatic uses the file's Bayer pattern tags.</p>",
      radiusLabel: "Smoothing:",
      radiusAuto: "Automatic, residual noise target (%):",
      radiusFixed: "Fixed radius (pixels of one colour):",
      radiusTip: "<p>Automatic picks the smallest radius that brings the flat's pixel noise down to the target. " +
                 "A larger radius removes more noise but also smooths small dust shadows and the real pixel-to-pixel " +
                 "sensitivity (which a noisy flat cannot measure anyway).</p>",
      openResult: "Open the result in PixInsight",
      analyze: "Check",
      run: "Smooth and save",
      close: "Close",
      noFile: "Select a master flat first.",
      // results
      resultHeader: "<p><b>%s</b> &mdash; %d x %d, %s</p>",
      layoutCfa: "CFA mosaic (4 colours)",
      layoutPlain: "%d channel(s), no CFA",
      phaseLine: "%s: level %.4f, pixel noise %.2f%%",
      verdictNoisy: "<p><b>The flat is noisy</b> (%.2f%% per pixel). Every light gets this pattern; with drift it shows as walking noise. " +
                    "Smoothing with radius %d brings it to about %.3f%%.</p>",
      verdictQuiet: "<p><b>The flat is quiet</b> (%.2f%% per pixel, target %.2f%%): smoothing is not needed and would only " +
                    "discard real detail. Nothing was written.</p>",
      verdictFixed: "<p>Smoothing with radius %d brings the pixel noise from %.2f%% to about %.3f%%.</p>",
      written: "<p>Written (%s outlier pixels replaced):</p><p>%s</p>",
      useInWbpp: "<p>In WBPP, remove the individual flat frames and add this file instead (it is read as a master flat).</p>"
   },
   ja: {
      language: "言語:",
      imageFiles: "画像ファイル",
      allFiles: "すべてのファイル",
      info: "<p><b>%s %s</b> &mdash; マスターフラットの画素ごとのノイズを取り除きます。枚数が少ない、または暗すぎるフラットは、" +
            "そのノイズをすべてのライトの同じ画素位置に乗せます。フレーム間でドリフトがあると、それが斜めの縞（縮緬ノイズ）になります。" +
            "色ごとに平滑化するので、周辺減光やゴミの影の補正は残ります。</p>",
      inputLabel: "マスターフラット:",
      inputTip: "<p>調べて平滑化するマスターフラット（XISFまたはFITS。WBPPが作るCFAのマスターフラット、またはモノクロ／RGBのフラット）。</p>",
      outputLabel: "出力ファイル:",
      outputTip: "<p>空欄のときは、マスターフラットと同じフォルダに &lt;名前&gt;_smooth.xisf を書き出します。" +
                 "FITSキーワードとプロパティはすべて引き継ぐので、WBPPはマスターフラットとして読み込みます。</p>",
      cfaLabel: "CFA（ベイヤー）配列:",
      cfaAuto: "自動（ファイルの情報から判断）",
      cfaOn: "あり：色ごとに別々に平滑化",
      cfaOff: "なし：チャンネル全体を平滑化",
      cfaTip: "<p>カラーカメラ（OSC／デジカメ）のマスターフラットはベイヤー配列です。4つの色位置を別々に平滑化するので、色が混ざりません。" +
              "自動ではファイルのベイヤー配列の情報を使います。</p>",
      radiusLabel: "平滑化:",
      radiusAuto: "自動、残すノイズの目標（%）:",
      radiusFixed: "半径を指定（1色あたりの画素数）:",
      radiusTip: "<p>自動では、フラットの画素ノイズを目標まで下げる最小の半径を選びます。" +
                 "半径を大きくするとノイズはより減りますが、小さなゴミの影や本来の画素ごとの感度差（ノイズの多いフラットではどのみち測れません）もぼけます。</p>",
      openResult: "結果をPixInsightで開く",
      analyze: "調べる",
      run: "平滑化して保存",
      close: "閉じる",
      noFile: "先にマスターフラットを選んでください。",
      resultHeader: "<p><b>%s</b> &mdash; %d x %d、%s</p>",
      layoutCfa: "CFA配列（4色）",
      layoutPlain: "%dチャンネル、CFAなし",
      phaseLine: "%s：レベル %.4f、画素ノイズ %.2f%%",
      verdictNoisy: "<p><b>フラットのノイズが多すぎます</b>（1画素あたり%.2f%%）。この模様がすべてのライトに乗り、ドリフトがあると縮緬ノイズになります。" +
                    "半径%dで平滑化すると約%.3f%%になります。</p>",
      verdictQuiet: "<p><b>フラットのノイズは十分少ないです</b>（1画素あたり%.2f%%、目標%.2f%%）。平滑化は不要で、本来の細部を失うだけです。" +
                    "ファイルは書き出していません。</p>",
      verdictFixed: "<p>半径%dで平滑化すると、画素ノイズは%.2f%%から約%.3f%%になります。</p>",
      written: "<p>書き出しました（外れ値の画素%s個を置き換え）:</p><p>%s</p>",
      useInWbpp: "<p>WBPPでは、個々のフラットを外して代わりにこのファイルを入れてください（マスターフラットとして読み込まれます）。</p>"
   }
};

// the dialog language (user interface state)
const fsLanguageState = { current: "en" };

function fsLanguage()
{
   return fsLanguageState.current;
}

/** Selects the language; returns false (and keeps the current one) for an unknown language. */
function fsSetLanguage( language )
{
   if ( FS_LANGUAGES.indexOf( language ) < 0 )
      return false;
   fsLanguageState.current = language;
   return true;
}

/** Text for `key` in the current language, else in English, else the key itself. */
function fsMsg( key )
{
   const table = FS_STRINGS[ fsLanguageState.current ];
   if ( table && table[ key ] !== undefined )
      return table[ key ];
   return ( FS_STRINGS.en[ key ] !== undefined ) ? FS_STRINGS.en[ key ] : key;
}

if ( typeof module !== "undefined" && module.exports )
   module.exports = { FS_LANGUAGES, FS_LANGUAGE_NAMES, FS_STRINGS, fsLanguage, fsSetLanguage, fsMsg };
