# ApranatNR

[日本語](README.ja.md)

A PixInsight script for preprocessing noise countermeasures devised by apranat (あぷらなーと) that WBPP does not have. ApranatNR is an independent implementation of methods published on [apranat's blog](https://apranat.exblog.jp/) (in Japanese).

| Method | What it does | Original article |
|---|---|---|
| Drunk (RTN) pixel correction | Finds pixels that jump between two levels from frame to frame (from individual darks) and replaces them in every light by the median of their same-color neighbors | [32142709](https://apranat.exblog.jp/32142709/) |
| Cool file correction | Finds pixels darker than their surroundings in the unregistered stack and lifts them in every frame | [28135658](https://apranat.exblog.jp/28135658/) |
| Cosmicut | Averages registered frames without each pixel's brightest frame: (sum − max) ÷ (N − 1) | [31257871](https://apranat.exblog.jp/31257871/) |

## Requirements

- PixInsight 1.9.6 or later
- For the WBPP integration: WBPP 3.2 or later (WBPP itself is not modified)

## Use

- **Standalone**: run `ApranatNR.js` (Script > Execute Script File...). Tab ① corrects calibrated, undebayered lights; tab ② makes a Cosmicut master from registered frames.
- **Inside WBPP**: in WBPP's Pipeline tab, enable "Pipeline builder" and select `ApranatNR-WBPP-Builder.js`. The ApranatNR step runs right after calibration. Options are in `ApranatNR-WBPP-Settings.json` next to it. The builder also runs [FlatSmooth](../FlatSmooth/README.md) on every master flat the lights use, before the light calibration (`flatSmooth*` options; a quiet flat is left alone).
- The dialog is in English by default; choose "日本語" under "Language" to switch to Japanese.

Full documentation: [ApranatNR-Guide-en.html](ApranatNR-Guide-en.html) (English), [ApranatNR-Guide.html](ApranatNR-Guide.html) (Japanese).

## Highlights

- Drunk pixel criterion from the physics of a dark frame: a pixel is a drunk pixel when its fluctuation (without its highest and lowest value) exceeds 4 × the fluctuation expected from read noise and dark current shot noise at its lower-quartile level. Hot pixels are not taken for drunk pixels.
- Structure protection: no repair where the replacement would change a pixel by more than 5σ, or where the unregistered stack of the uncorrected lights shows a star (own excess above 5σ, or a 3σ footprint on the adjacent pixels). Faint stars on defect pixels are not dimmed in undithered data.
- Tested on ZWO ASI533MC Pro data: background noise −1.2% to −1.7% compared with WBPP alone, with no loss of star flux (see section 9 of the guide).

## Tests

```bash
node --test tests/*.test.js          # unit tests (Node)
tests/wbpp-e2e/run.sh                # end-to-end test with the real WBPP (headless PixInsight)
```

After changing a source file, regenerate the WBPP builder with `node tools/build-wbpp-builder.js`.

## Credits

Methods devised by apranat (apranat.exblog.jp). WBPP is a PixInsight script by its authors; ApranatNR only plugs into its official Pipeline builder.
