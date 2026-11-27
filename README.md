# PixInsight scripts for apranat's noise countermeasures

[日本語](README.ja.md)

Two PixInsight scripts that bring the preprocessing noise countermeasures published by apranat (あぷらなーと, [apranat.exblog.jp](https://apranat.exblog.jp/), in Japanese) to PixInsight. They are independent implementations of the published methods. A third script, FlatSmooth, is a related tool of my own (not one of apranat's methods).

| Script | What it does |
|---|---|
| [ApranatNR](ApranatNR/README.md) | Drunk (RTN) pixel correction (software pixel mapping), cool file correction and Cosmicut. Runs standalone or inside WBPP through WBPP's official Pipeline builder |
| [DarkPixelPlot](DarkPixelPlot/README.md) | Plots each pixel's median brightness against its fluctuation over a sequence of dark frames, showing normal, hot and drunk pixels |
| [FlatSmooth](FlatSmooth/README.md) | Checks a master flat for per-pixel noise and smooths it within each CFA colour, so that a noisy flat does not cause walking noise. Also runs inside WBPP through the ApranatNR pipeline builder |

All scripts have an English (default) and a Japanese user interface.

## Requirements

- PixInsight 1.9.6 or later
- For ApranatNR inside WBPP: WBPP 3.2 or later (WBPP is not included and not modified)

## Installation

1. Download this repository (Code > Download ZIP) or clone it.
2. In PixInsight, run a script with **Script > Execute Script File...** (`ApranatNR/ApranatNR.js`, `DarkPixelPlot/DarkPixelPlot.js` or `FlatSmooth/FlatSmooth.js`).
3. To get menu entries, add the repository folder in **Script > Feature Scripts...**: ApranatNR appears under Script > Preprocessing, DarkPixelPlot and FlatSmooth under Script > Utilities.
4. For the WBPP integration, select `ApranatNR/ApranatNR-WBPP-Builder.js` as WBPP's Pipeline builder (see the [ApranatNR guide](ApranatNR/ApranatNR-Guide-en.html)).

## Documentation

- ApranatNR guide: [English](ApranatNR/ApranatNR-Guide-en.html), [Japanese](ApranatNR/ApranatNR-Guide.html) (download and open in a browser)
- Noise measurement guide (how the three tools measure noise, and how results were compared): [English](docs/NoiseMeasurement-Guide-en.html), [Japanese](docs/NoiseMeasurement-Guide.html)
- [ApranatNR README](ApranatNR/README.md), [DarkPixelPlot README](DarkPixelPlot/README.md), [FlatSmooth README](FlatSmooth/README.md)

## Tests

Unit tests run with Node.js (`node --test tests/*.test.js` in each script folder). Tests that need PixInsight run it headless; see each README.

## Credits and license

- Methods and analysis of ApranatNR and DarkPixelPlot devised by apranat (apranat.exblog.jp).
- WBPP is a PixInsight script by its authors; ApranatNR only plugs into its Pipeline builder.
- Code: MIT License, see [LICENSE](LICENSE).
