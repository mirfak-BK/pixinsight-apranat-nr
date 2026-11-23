// ----------------------------------------------------------------------------
// DarkPixelPlot-Strings.js - dialog and plot texts in English and Japanese.
//
// Messages may contain format() specifiers (%s, %d, %g, %.1f); both
// languages must use the same specifiers in the same order (checked by the
// tests). Console log messages stay in English.
// ----------------------------------------------------------------------------

const DPP_LANGUAGES = [ "en", "ja" ];
const DPP_LANGUAGE_NAMES = { en: "English", ja: "日本語" };

const DPP_STRINGS = {
   en: {
      // dialog
      language: "Language:",
      imageFiles: "Image files",
      allFiles: "All files",
      info: "<p><b>%s %s</b> &mdash; plots each pixel's \"median brightness\" against its \"brightness fluctuation (standard deviation)\" " +
            "from individual dark frames, in the format of apranat's analysis.</p>",
      addFiles: "Add...",
      selectDarks: "Select dark frames (individual files with the same settings, %d or more)",
      clear: "Clear",
      filesGroup: "Dark frames (raw individual files of the same exposure, gain and temperature; %d or more, 20 or more recommended)",
      frameCount: "%d frames",
      mapLabel: "Defect map (optional):",
      mapTip: "<p>An rtn_defect_map.xisf from ApranatNR: its pixels are shown in orange. " +
              "When empty, this tool marks the pixels with a large fluctuation itself.</p>",
      outLabel: "Output file (PNG):",
      outTip: "<p>When empty, %s is written in the folder of the first dark frame. " +
              "A .json file of the same name receives a summary of the numbers.</p>",
      titleLabel: "Plot title:",
      titleTip: "<p>When empty, the title is made from the FITS keywords (exposure time, gain) and the number of frames.</p>",
      ratioLabel: "Fluctuation ratio threshold:",
      ratioTip: "<p>A pixel is marked when its fluctuation without its highest and lowest value exceeds this factor times the fluctuation " +
                "expected at its level (read noise + dark current shot noise; the level is the pixel's lower quartile, without its jumps). " +
                "Default 4, the same criterion as ApranatNR. With a defect map it only sets the dashed line of the plot.</p>",
      apranatAxis: "Fix the vertical axis to 10¹–10⁴ (as in apranat's plots)",
      apranatAxisTip: "<p>The vertical axis (fluctuation) spans 10 to 10,000 ADU with ticks at 10¹, 10², 10³ and 10⁴, " +
                      "for comparing plots of other cameras or settings side by side. Pixels outside the range are not drawn; " +
                      "their number is shown below the plot.</p><p>When off, the range follows the data.</p>",
      openResult: "Open the plot in PixInsight",
      run: "Make plot",
      close: "Close",
      done: "<p>Plot written:</p><p>%s</p>",
      // default title and marks (the plot)
      titleExposure: "%gs",
      titleFrames: "%d frames",
      titleSeparator: ", ",
      titleFormat: "Dark (%s): median vs fluctuation of each pixel",
      markMap: "Pixels of the defect map (%s)",
      markOwn: "Fluctuation above %g × typical (judged without max/min)",
      subtitle: "1 pixel = 1 point. Horizontal: median of %d frames; vertical: standard deviation (fluctuation) of %d frames. Darker = more pixels",
      yLabel: "Vertical: fluctuation = standard deviation (ADU, log scale)",
      yLabelApranat: "Vertical: fluctuation = standard deviation (ADU, log scale 10¹–10⁴)",
      panelA: "(a) Whole range (log horizontal axis)",
      xLabelA: "Median of each pixel (ADU, log scale)",
      noteNormal: "← normal pixels",
      noteDrunk: "← drunk pixels (normal median, large fluctuation)",
      noteHot: "hot pixels (high median) →",
      panelB: "(b) Zoom on the normal pixels (linear horizontal axis)",
      xLabelB: "Median of each pixel (ADU, linear scale)",
      noteNormalZoom: "normal pixels",
      noteDrunkZoom: "drunk pixels",
      legendDensity: "Pixel distribution (darker = more)",
      legendTypical: "Typical fluctuation",
      legendThreshold: "%g × typical (threshold guide)",
      legendZoom: "Zoom: medians come in steps of %g ADU only, so they line up in columns",
      statsMarked: "Typical fluctuation of normal pixels %.1f ADU / marked pixels %s (fluctuation %.1f × typical)",
      statsOutside: " / outside the vertical range: %s pixels",
      statsHot: "Hot pixels (median above the typical fluctuation × %d) %s / pixels with a single large jump %s",
      modelLine: "Typical = √( %.1f² + %.2f × excess level ): read noise + dark-current shot noise (from %s warm pixels)",
      modelFlat: "Typical = read noise %.1f ADU (too few warm pixels to measure the shot noise)"
   },
   ja: {
      language: "Language:",
      imageFiles: "画像ファイル",
      allFiles: "すべてのファイル",
      info: "<p><b>%s %s</b> &mdash; 個別のダークフレームから、画素ごとの" +
            "「輝度中央値」と「輝度揺らぎ（標準偏差）」のグラフを作ります（あぷらなーと氏の分析と同じ形式）。</p>",
      addFiles: "追加...",
      selectDarks: "ダークフレームを選択（同じ設定の個別ファイル、%d枚以上）",
      clear: "クリア",
      filesGroup: "ダークフレーム（同じ露出・ゲイン・温度の未処理の個別ファイル、%d枚以上。20枚以上を推奨）",
      frameCount: "%d 枚",
      mapLabel: "欠陥マップ（任意）:",
      mapTip: "<p>ApranatNR の rtn_defect_map.xisf を指定すると、その画素をオレンジで表示します。" +
              "空欄の場合は、このツール自身が揺らぎの大きい画素を判定して表示します。</p>",
      outLabel: "出力ファイル（PNG）:",
      outTip: "<p>空欄の場合は、最初のダークと同じフォルダに %s を作ります。" +
              "同じ名前の .json ファイルに数値のまとめも保存します。</p>",
      titleLabel: "グラフの題名:",
      titleTip: "<p>空欄の場合は、FITS キーワード（露出時間・ゲイン）と枚数から自動で付けます。</p>",
      ratioLabel: "判定の倍率:",
      ratioTip: "<p>最大値と最小値を1枚ずつ除いた揺らぎが、その明るさで期待される揺らぎ（読み出しノイズ＋ダーク電流のショットノイズ。" +
                "明るさは跳ねた分を除いた各画素の下側の値）の何倍を超えたら印を付けるか（既定 4。ApranatNR と同じ判定）。" +
                "欠陥マップを指定した場合はグラフの破線にだけ使います。</p>",
      apranatAxis: "縦軸を 10¹〜10⁴ に固定する（あぷらなーと氏のグラフに合わせる）",
      apranatAxisTip: "<p>縦軸（揺らぎ）の範囲を 10〜10,000 ADU に固定し、目盛を 10¹・10²・10³・10⁴ にします。" +
                      "別のカメラや設定のグラフと並べて比べるときに使います。範囲外の画素は描かれず、その数を下に表示します。</p>" +
                      "<p>オフの場合は、データに合わせて範囲を決めます。</p>",
      openResult: "作成したグラフを PixInsight で開く",
      run: "グラフを作成",
      close: "閉じる",
      done: "<p>グラフを作成しました:</p><p>%s</p>",
      titleExposure: "%g秒",
      titleFrames: "%d枚",
      titleSeparator: "・",
      titleFormat: "ダーク（%s）の輝度中央値と輝度揺らぎ",
      markMap: "欠陥マップの画素（%s）",
      markOwn: "揺らぎが典型の%g倍を超える画素（最大・最小を除いて判定）",
      subtitle: "1画素 = 1点。横軸は%d枚の中央値、縦軸は%d枚の標準偏差（揺らぎ）。色が濃いほど画素が多い",
      yLabel: "縦軸：揺らぎ＝標準偏差（ADU、対数目盛）",
      yLabelApranat: "縦軸：揺らぎ＝標準偏差（ADU、10¹〜10⁴ の対数目盛）",
      panelA: "(a) 全体（横軸は対数）",
      xLabelA: "画素ごとの中央値（ADU、対数目盛）",
      noteNormal: "← 通常の画素",
      noteDrunk: "← 酩酊ピクセル（中央値は普通・揺らぎが大きい）",
      noteHot: "ホットピクセル（中央値が高い）→",
      panelB: "(b) 通常の画素の付近を拡大（横軸は等間隔）",
      xLabelB: "画素ごとの中央値（ADU、等間隔目盛）",
      noteNormalZoom: "通常の画素",
      noteDrunkZoom: "酩酊ピクセル",
      legendDensity: "画素の分布（濃いほど多い）",
      legendTypical: "典型的な揺らぎ",
      legendThreshold: "その%g倍（判定の目安）",
      legendZoom: "拡大図：中央値は%g ADU刻みの値だけなので、縦の列に並びます",
      statsMarked: "通常の画素の揺らぎ %.1f ADU ／ 印を付けた画素 %s（揺らぎは典型の%.1f倍）",
      statsOutside: " ／ 縦軸の範囲外 %s 画素",
      statsHot: "ホットピクセル（中央値が典型の揺らぎの%d倍以上高い） %s ／ 1枚だけ大きく飛んだ画素 %s",
      modelLine: "典型的な揺らぎ ＝ √( %.1f² ＋ %.2f × 通常より明るい分 )：読み出しノイズとダーク電流のショットノイズ（暖かい画素 %s から推定）",
      modelFlat: "典型的な揺らぎ ＝ 読み出しノイズ %.1f ADU（暖かい画素が少ないため、ショットノイズの係数は測れませんでした）"
   }
};

// the dialog and plot language (user interface state)
const dppLanguageState = { current: "en" };

function dppLanguage()
{
   return dppLanguageState.current;
}

/** Selects the language; returns false (and keeps the current one) for an unknown language. */
function dppSetLanguage( language )
{
   if ( DPP_LANGUAGES.indexOf( language ) < 0 )
      return false;
   dppLanguageState.current = language;
   return true;
}

/** Text for `key` in the current language, else in English, else the key itself. */
function dppMsg( key )
{
   const table = DPP_STRINGS[ dppLanguageState.current ];
   if ( table && table[ key ] !== undefined )
      return table[ key ];
   return ( DPP_STRINGS.en[ key ] !== undefined ) ? DPP_STRINGS.en[ key ] : key;
}

/**
 * Font for the plot: Japanese needs a font with Japanese glyphs, which
 * differs between platforms (platform: CoreApplication.platform).
 */
function dppFontFamily( language, platform )
{
   const p = String( platform ).toLowerCase();
   const os = ( p.indexOf( "mac" ) >= 0 ) ? "mac" : ( p.indexOf( "windows" ) >= 0 ) ? "windows" : "unix";
   const fonts = ( language === "ja" )
      ? { mac: "Hiragino Sans", windows: "Yu Gothic UI", unix: "Noto Sans CJK JP" }
      : { mac: "Helvetica Neue", windows: "Segoe UI", unix: "DejaVu Sans" };
   return fonts[ os ];
}

if ( typeof module !== "undefined" && module.exports )
   module.exports = { DPP_LANGUAGES, DPP_LANGUAGE_NAMES, DPP_STRINGS, dppLanguage, dppSetLanguage, dppMsg, dppFontFamily };
