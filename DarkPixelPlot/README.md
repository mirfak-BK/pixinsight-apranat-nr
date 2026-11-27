# DarkPixelPlot

[日本語](README.ja.md)

A PixInsight script that plots each pixel's median brightness against its brightness fluctuation (standard deviation) over a sequence of individual dark frames, in the format of [apranat's analysis of drunk (RTN) pixels](https://apranat.exblog.jp/32142709/). Normal, hot and drunk pixels separate clearly.

- **(a) Whole range** (log median axis) and **(b) zoom on the normal pixels** (linear median axis); the fluctuation axis is logarithmic, optionally fixed to 10¹–10⁴ like apranat's plots.
- Pixels whose fluctuation (without their highest and lowest value) exceeds 4 × the fluctuation expected from read noise and dark current shot noise at their lower-quartile level are marked in orange — the same criterion as [ApranatNR](../ApranatNR/README.md). An ApranatNR defect map can be shown instead.
- The typical fluctuation and the threshold are drawn as curves from that formula; its parameters are printed below the plot.
- Writes a PNG plus a JSON summary (counts, noise model parameters).
- Reads FITS, XISF and camera raw files (CR2 and others, as undebayered sensor values).
- Dialog and plot in English (default) or Japanese.

## Use

Run `DarkPixelPlot.js` (Script > Execute Script File...), add 8 or more individual dark frames of the same exposure, gain and temperature (20 or more recommended), and press "Make plot".

Unattended (headless PixInsight):

```text
PixInsight -n --automation-mode --force-exit -r="DarkPixelPlot.js,--out=<png>[,--map=<xisf>][,--title=<text>][,--ratio=<n>][,--yaxis=apranat|auto][,--lang=en|ja],<dark1>,<dark2>,..."
```

`tests/run-headless.sh <dark folder> <file name regex> <out.png> [map] [extra options]` wraps this; errors are written to `<out>.png.error.txt`.

## How it measures

What the plot axes and the typical-fluctuation curve mean: [Noise measurement guide](https://mirfak-bk.github.io/pixinsight-apranat-nr/docs/NoiseMeasurement-Guide-en.html#dark) ([日本語](https://mirfak-bk.github.io/pixinsight-apranat-nr/docs/NoiseMeasurement-Guide.html#dark)).

## Tests

```bash
node --test tests/*.test.js
```

## Credits

The plot follows apranat's analysis (apranat.exblog.jp).
