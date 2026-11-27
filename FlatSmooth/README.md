# FlatSmooth

[日本語](README.ja.md)

A PixInsight script that checks a master flat for per-pixel noise and smooths it within each CFA colour.

**Why:** a master flat built from too few or too dim flat frames carries per-pixel noise. Every light is divided by it, so every light gets the same pattern at the same sensor position. When the field drifts between frames (no dithering), registration smears that pattern into diagonal streaks: *walking noise*. Real case: a Canon 6D set whose flats were dimmer than the sky background had 6–9 % pixel noise in the master flat. That noise made the walking noise, and smoothing the flat removed the streaks (fine noise −35 %, star flux unchanged, large-scale shading within 0.04 %).

## What it does

- **Check:** measures the relative pixel noise of each colour (R, G, G, B positions of a Bayer mosaic, or each channel of a mono/RGB flat).
- **Smooth:** replaces outlier pixels (hot, dead, non-finite) by the median of their 8 same-colour neighbours, then applies 3 box passes (≈ Gaussian) within each colour. Colours never mix.
- **Radius:** automatic (the smallest radius that brings the noise down to a target, default 0.3 %) or fixed. A quiet flat is left alone in automatic mode.
- **Output:** `<name>_smooth.xisf`, with all FITS keywords and properties (IMAGETYP = Master Flat, Bayer pattern) plus HISTORY lines, so WBPP reads it as a master flat. The rejection maps stored in WBPP masters are not copied.

Trade-off: pixel-to-pixel sensitivity differences (PRNU) and dust shadows smaller than the smoothing scale are no longer corrected. A noisy flat cannot measure them anyway; with a good flat (well exposed, 20+ frames) this tool is not needed.

## Use

Run `FlatSmooth.js` (Script > Execute Script File...), choose the master flat, press "Check", then "Smooth and save". In WBPP, remove the individual flat frames and add the `_smooth.xisf` file instead.

**Automatically inside WBPP:** the ApranatNR pipeline builder (`../ApranatNR/ApranatNR-WBPP-Builder.js`) runs FlatSmooth on each master flat after WBPP builds it (or on a master flat you added) and calibrates the lights with the smoothed copy, written to `<output>/flatsmooth/`. WBPP's own master flat and file list are not changed. Options: `flatSmoothEnabled`, `flatSmoothRadius` (0 = automatic) and `flatSmoothTargetPercent` in `ApranatNR-WBPP-Settings.json`. To use only FlatSmooth, set `rtnEnabled` and `coolEnabled` to false there.

Unattended (headless PixInsight):

```text
PixInsight -n --automation-mode --force-exit -r="FlatSmooth.js,--out=<xisf>[,--target=<percent>|--radius=<n>][,--cfa=auto|on|off][,--check][,--lang=en|ja],<master flat>"
```

A JSON summary goes to `<out>.json`, errors to `<out>.error.txt`. `tests/run-headless.sh <master flat> <out.xisf> [options]` wraps this.

## How it measures

How the pixel noise and the automatic radius are computed, and why flat noise causes walking noise: [Noise measurement guide](https://mirfak-bk.github.io/pixinsight-apranat-nr/docs/NoiseMeasurement-Guide-en.html#flat) ([日本語](https://mirfak-bk.github.io/pixinsight-apranat-nr/docs/NoiseMeasurement-Guide.html#flat)).

## Tests

```bash
node --test tests/*.test.js
```

`tests/FlatSmooth-DialogTest.js` builds the dialog in both languages in a headless PixInsight instance.
