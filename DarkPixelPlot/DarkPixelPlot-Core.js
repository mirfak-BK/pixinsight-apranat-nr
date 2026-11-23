// ----------------------------------------------------------------------------
// DarkPixelPlot-Core.js - pure numerical part (no PJSR, testable in Node).
//
// Per-pixel statistics of a dark sequence for the "median vs fluctuation"
// plot described by apranat (https://apranat.exblog.jp/32142709/): every
// pixel is one point, x = median over the frames, y = standard deviation.
// ----------------------------------------------------------------------------

const DPP_MIN_FRAMES = 4;
const DPP_MAX_CURVE_SAMPLES = 1000000;   // same sampling as ApranatNR (ANR_MAX_STAT_SAMPLES)
// the shot-noise slope is measured on pixels at least this many read-noise
// units above the normal level: closer to it, the scatter of noisy pixels'
// own levels would be mistaken for dark current (same rule as ApranatNR)
const DPP_WARM_EXCESS_READS = 10;
// fewer warm pixels than this cannot give a slope: the model stays flat
const DPP_MIN_WARM_PIXELS = 50;
// lower quartile of a normal distribution, in standard deviations below the mean
const DPP_LOWER_QUARTILE_Z = 0.6745;
// typical fluctuations below half an ADU are not meaningful (quantized data):
// this floor keeps ratios finite for flat or clipped data
const DPP_MIN_TYPICAL = 0.5;
const DPP_RAMP = [ [ 0xcd, 0xe2, 0xfb ], [ 0x9e, 0xc5, 0xf4 ], [ 0x6d, 0xa7, 0xec ], [ 0x39, 0x87, 0xe5 ],
                   [ 0x25, 0x6a, 0xbf ], [ 0x18, 0x4f, 0x95 ], [ 0x0d, 0x36, 0x6b ] ];

/**
 * Per-pixel median, sample standard deviation, and "trimmed" mean and
 * standard deviation (without each pixel's highest and lowest sample, so that
 * a single cosmic ray or saturated frame does not make a pixel look noisy).
 * @param {ArrayLike<number>[]} frames equal-length pixel arrays (ADU)
 * @returns {{median: Float32Array, std: Float32Array, trimmedMean: Float32Array, trimmedStd: Float32Array, frames: number}}
 */
function dppPixelStats( frames )
{
   const n = frames.length;
   if ( n < DPP_MIN_FRAMES )
      throw new Error( "At least four dark frames are required." );
   const length = frames[ 0 ].length;
   if ( frames.some( f => f.length !== length ) )
      throw new Error( "All dark frames must have the same size." );

   const median = new Float32Array( length ), std = new Float32Array( length );
   const trimmedMean = new Float32Array( length ), trimmedStd = new Float32Array( length );
   const buf = new Float64Array( n );
   const h = n >> 1;
   for ( let i = 0; i < length; ++i )
   {
      for ( let k = 0; k < n; ++k )
      {
         const v = frames[ k ][ i ];
         let j = k - 1;
         for ( ; j >= 0 && buf[ j ] > v; --j )
            buf[ j + 1 ] = buf[ j ];
         buf[ j + 1 ] = v;
      }
      median[ i ] = ( n & 1 ) ? buf[ h ] : 0.5 * ( buf[ h - 1 ] + buf[ h ] );
      let sum = 0, sumSq = 0;
      for ( let k = 0; k < n; ++k )
      {
         sum += buf[ k ];
         sumSq += buf[ k ] * buf[ k ];
      }
      std[ i ] = dppStdFrom( sum, sumSq, n );
      const lo = buf[ 0 ], hi = buf[ n - 1 ];
      trimmedMean[ i ] = ( sum - lo - hi ) / ( n - 2 );
      trimmedStd[ i ] = dppStdFrom( sum - lo - hi, sumSq - lo * lo - hi * hi, n - 2 );
   }
   return { median: median, std: std, trimmedMean: trimmedMean, trimmedStd: trimmedStd, frames: n };
}

function dppStdFrom( sum, sumSq, n )
{
   return Math.sqrt( Math.max( 0, ( sumSq - sum * sum / n ) / ( n - 1 ) ) );
}

function dppStride( length, maxSamples )
{
   // an odd stride cannot lock onto one parity of columns (CFA phase)
   let stride = Math.max( 1, Math.ceil( length / maxSamples ) );
   return ( stride > 1 && stride % 2 === 0 ) ? stride + 1 : stride;
}

function dppSortedMedian( sorted )
{
   const h = sorted.length >> 1;
   return ( sorted.length & 1 ) ? sorted[ h ] : 0.5 * ( sorted[ h - 1 ] + sorted[ h ] );
}

/**
 * Typical fluctuation as a function of the dark level, from the physics of a
 * dark frame: read noise plus the shot noise of the extra dark signal,
 *    typical(level)^2 = read^2 + slope * max(0, level - base).
 * base and read are the medians of level and value (almost all pixels are
 * normal); slope is the median of (value^2 - read^2) / (level - base) over the
 * warm pixels, well above the base level. A curve measured group by group
 * would instead be raised by the noisy pixels it should find wherever they
 * are numerous (off the normal level) and end below the brightest hot pixels.
 * @returns {{base: number, read: number, slope: number, warmPixels: number}}
 */
function dppNoiseModel( level, value, maxSamples = DPP_MAX_CURVE_SAMPLES )
{
   const stride = dppStride( level.length, maxSamples );
   const levels = [], values = [];
   for ( let i = 0; i < level.length; i += stride )
      if ( Number.isFinite( level[ i ] ) && Number.isFinite( value[ i ] ) )
      {
         levels.push( level[ i ] );
         values.push( value[ i ] );
      }
   if ( levels.length === 0 )
      throw new Error( "No valid pixels." );
   const base = dppSortedMedian( Float64Array.from( levels ).sort() );
   const read = dppSortedMedian( Float64Array.from( values ).sort() );
   // warm pixels are searched among all pixels (too rare for the sample above),
   // then at most maxSamples of them are used
   const minExcess = DPP_WARM_EXCESS_READS * read;
   const isWarm = i => level[ i ] - base > minExcess && Number.isFinite( level[ i ] ) && Number.isFinite( value[ i ] );
   let warmPixels = 0;
   for ( let i = 0; i < level.length; ++i )
      if ( isWarm( i ) )
         ++warmPixels;
   const warmStride = dppStride( warmPixels, maxSamples );
   const slopes = [];
   for ( let i = 0, k = 0; i < level.length; ++i )
      if ( isWarm( i ) && k++ % warmStride === 0 )
         slopes.push( ( value[ i ] * value[ i ] - read * read ) / ( level[ i ] - base ) );
   const slope = ( warmPixels >= DPP_MIN_WARM_PIXELS ) ? Math.max( 0, dppSortedMedian( Float64Array.from( slopes ).sort() ) ) : 0;
   return { base: base, read: read, slope: slope, warmPixels: warmPixels };
}

/**
 * Level of each pixel for the noise model: an estimate of its lower quartile,
 * trimmed mean - 0.6745 x trimmed std. A pixel that jumps upward (two-level
 * defects, flickering dark current) keeps its normal low level, so its raised
 * mean is not mistaken for the dark current of a warm pixel; for a warm pixel
 * it is the dark level less a little of its own shot noise.
 * @returns {Float32Array}
 */
function dppLowerLevel( mean, std )
{
   if ( mean.length !== std.length )
      throw new Error( "lowerLevel: size mismatch." );
   return Float32Array.from( mean, ( m, i ) => m - DPP_LOWER_QUARTILE_Z * std[ i ] );
}

function dppModelTypical( model, level )
{
   return ( model.slope > 0 ) ? Math.sqrt( model.read * model.read + model.slope * Math.max( 0, level - model.base ) ) : model.read;
}

/**
 * count + 1 points [level, scale * typical] evenly spaced along the axis
 * (log or linear), for drawing the model as a smooth curve.
 */
function dppModelCurve( model, axis, scale, count )
{
   const points = [];
   for ( let k = 0; k <= count; ++k )
   {
      const t = k / count;
      const v = axis.isLog ? axis.min * Math.pow( axis.max / axis.min, t ) : axis.min + ( axis.max - axis.min ) * t;
      points.push( [ v, scale * dppModelTypical( model, v ) ] );
   }
   return points;
}

/**
 * Dashes along a polyline (pixel coordinates): segments [x0, y0, x1, y1] of
 * length `dash` separated by `gap`, continuing across the vertices.
 */
function dppDashSegments( points, dash, gap )
{
   const segments = [];
   if ( !( dash > 0 && gap >= 0 ) )
      return segments;
   let inDash = true, phase = 0;   // phase: length already used of the current dash or gap
   for ( let k = 0; k + 1 < points.length; ++k )
   {
      const [ x0, y0 ] = points[ k ], [ x1, y1 ] = points[ k + 1 ];
      const length = Math.hypot( x1 - x0, y1 - y0 );
      const at = t => [ x0 + ( x1 - x0 ) * t / length, y0 + ( y1 - y0 ) * t / length ];
      let t = 0;
      while ( t < length )
      {
         const remain = ( inDash ? dash : gap ) - phase;
         const step = Math.min( remain, length - t );
         if ( inDash && step > 0 )
            segments.push( at( t ).concat( at( t + step ) ) );
         t += step;
         if ( step >= remain )
         {
            // switch exactly at the boundary, so that rounding never stalls the walk
            inDash = !inDash;
            phase = 0;
         }
         else
            phase += step;
      }
   }
   return segments;
}

function dppMedianOf( values, maxSamples )
{
   const stride = dppStride( values.length, maxSamples );
   const sample = [];
   for ( let i = 0; i < values.length; i += stride )
      if ( Number.isFinite( values[ i ] ) )
         sample.push( values[ i ] );
   return dppSortedMedian( Float64Array.from( sample ).sort() );
}

/**
 * Pixel populations of the plot.
 *  - noisy ("drunk"/RTN): trimmed std > ratio x the trimmed std expected from
 *    read noise and dark-current shot noise at the pixel's lower-quartile
 *    level (trimmed mean - 0.6745 x trimmed std), the ApranatNR criterion (or
 *    the pixels of `externalMap` when given). The lower quartile keeps the
 *    normal level of pixels that jump upward, where a mean or median would
 *    mistake the jumps for dark current.
 *  - hot: median above the overall median by more than hotSigmas typical stds
 *  - spikes: std > ratio x typical std only because of one frame, i.e. the
 *    trimmed std stays normal (independent of an external map)
 */
function dppClassify( stats, ratio, hotSigmas, externalMap = null )
{
   const n = stats.median.length;
   if ( externalMap && externalMap.length !== n )
      throw new Error( "The defect map size does not match the dark frames." );
   const levels = dppLowerLevel( stats.trimmedMean, stats.trimmedStd );
   const stdModel = dppNoiseModel( levels, stats.std );             // drawn on the plot, spike test
   const trimmedModel = dppNoiseModel( levels, stats.trimmedStd );  // the criterion
   const medianLevel = dppMedianOf( stats.median, DPP_MAX_CURVE_SAMPLES );
   const typicalStd = dppMedianOf( stats.std, DPP_MAX_CURVE_SAMPLES );
   const hotLevel = medianLevel + hotSigmas * typicalStd;

   const noisy = externalMap || new Uint8Array( n );
   const counts = { pixels: n, noisy: 0, hot: 0, spikes: 0 };
   const ratios = [];
   for ( let i = 0; i < n; ++i )
   {
      const level = levels[ i ];
      const typical = model => Math.max( DPP_MIN_TYPICAL, dppModelTypical( model, level ) );
      const trimmedHigh = stats.trimmedStd[ i ] > ratio * typical( trimmedModel );
      if ( !externalMap && trimmedHigh )
         noisy[ i ] = 1;
      if ( noisy[ i ] )
      {
         ++counts.noisy;
         if ( ratios.length < DPP_MAX_CURVE_SAMPLES )
            ratios.push( stats.std[ i ] / typical( stdModel ) );
      }
      if ( !trimmedHigh && stats.std[ i ] > ratio * typical( stdModel ) )
         ++counts.spikes;
      if ( stats.median[ i ] > hotLevel )
         ++counts.hot;
   }
   return {
      noisy: noisy, counts: counts, medianLevel: medianLevel, typicalStd: typicalStd, hotLevel: hotLevel,
      noisyStdRatio: ratios.length > 0 ? dppSortedMedian( Float64Array.from( ratios ).sort() ) : 0,
      stdModel: stdModel, trimmedModel: trimmedModel
   };
}

/** Maps values in [min, max] to pixels in [0, length], linear or logarithmic. */
function dppAxis( min, max, isLog, length )
{
   const f = isLog ? Math.log10 : ( v => v );
   const f0 = f( min ), f1 = f( max );
   return { min: min, max: max, isLog: isLog, length: length, pos: v => ( f( v ) - f0 ) / ( f1 - f0 ) * length };
}

function dppLogTicks( min, max )
{
   if ( !( min > 0 && max > min && Number.isFinite( max ) ) )
      return [];
   const out = [];
   for ( let e = Math.floor( Math.log10( min ) ); e <= Math.ceil( Math.log10( max ) ); ++e )
      for ( const m of [ 1, 2, 3, 5 ] )
      {
         const v = m * Math.pow( 10, e );
         if ( v >= min && v <= max )
            out.push( Math.round( v * 1e6 ) / 1e6 );
      }
   return out;
}

/** Powers of ten inside [min, max]. */
function dppDecadeTicks( min, max )
{
   if ( !( min > 0 && max > min && Number.isFinite( max ) ) )
      return [];
   const out = [];
   for ( let e = Math.ceil( Math.log10( min ) - 1e-9 ); e <= Math.floor( Math.log10( max ) + 1e-9 ); ++e )
      out.push( Math.pow( 10, e ) );
   return out;
}

const DPP_SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** 1000 -> "10³" */
function dppDecadeLabel( v )
{
   const e = Math.round( Math.log10( v ) );
   return "10" + String( Math.abs( e ) ).split( "" ).map( d => DPP_SUPERSCRIPT_DIGITS.charAt( +d ) ).join( "" );
}

// fixed fluctuation axis of apranat's plots: 10^1 to 10^4
const DPP_APRANAT_Y_RANGE = [ 10, 10000 ];

/**
 * Fluctuation (std) axis range: apranat's fixed 10^1..10^4, or a range that
 * follows the data and stays valid for degenerate sets.
 */
function dppYRange( std, apranatAxis )
{
   if ( apranatAxis )
      return DPP_APRANAT_Y_RANGE.slice();
   const low = Math.max( 0.5, dppPercentile( std, 0.001 ) * 0.8 );
   return [ low, Math.max( dppPercentile( std, 99.999 ) * 1.2, low * 4 ) ];
}

function dppLinearTicks( min, max, maxCount )
{
   if ( !( max > min && Number.isFinite( min ) && Number.isFinite( max ) ) )
      return [];
   const raw = ( max - min ) / Math.max( 1, maxCount );
   const p = Math.pow( 10, Math.floor( Math.log10( raw ) ) );
   const step = [ 1, 2, 5, 10 ].map( m => m * p ).find( s => s >= raw );
   const out = [];
   for ( let v = Math.ceil( min / step ) * step; v <= max; v += step )
      out.push( Math.round( v * 1e6 ) / 1e6 );
   return out;
}

/** Point counts per cell (row 0 = top); every point at its exact value. */
function dppDensityGrid( xs, ys, xAxis, yAxis )
{
   const w = Math.round( xAxis.length ), h = Math.round( yAxis.length );
   const counts = new Uint32Array( w * h );
   let max = 0;
   for ( let i = 0; i < xs.length; ++i )
   {
      const x = xs[ i ];
      const y = ys[ i ];
      if ( !( x >= xAxis.min && x <= xAxis.max && y >= yAxis.min && y <= yAxis.max ) )
         continue;
      const cx = Math.min( w - 1, Math.floor( xAxis.pos( x ) ) );
      const cy = h - 1 - Math.min( h - 1, Math.floor( yAxis.pos( y ) ) );
      const c = ++counts[ cy * w + cx ];
      if ( c > max )
         max = c;
   }
   return { counts: counts, width: w, height: h, max: max };
}

/**
 * Linear zoom range in which each value step (quantum) spans a whole number
 * of pixels and the discrete values fall on pixel centres, so that quantized
 * medians draw as evenly spaced columns instead of irregular stripes. The
 * range is kept unchanged when the step is unknown or finer than a pixel.
 * @returns {{min: number, max: number, pxPerStep: number}}
 */
function dppAlignedZoom( min, max, quantum, pixels, anchor )
{
   const steps = ( max - min ) / quantum;
   if ( !( quantum > 0 && max > min && steps <= pixels ) )
      return { min: min, max: max, pxPerStep: 0 };
   const k = Math.max( 1, Math.floor( pixels / steps ) );
   const range = pixels / k * quantum;
   const start = anchor + Math.round( ( ( min + max ) / 2 - range / 2 - anchor ) / quantum ) * quantum - quantum / ( 2 * k );
   return { min: start, max: start + range, pxPerStep: k };
}

/** Drawn width (pixels) of one discrete column, given the pixels per value step. */
function dppColumnWidth( pxPerStep )
{
   return ( pxPerStep < 3 ) ? 1 : Math.min( 6, Math.max( 1, Math.round( pxPerStep * 0.25 ) ) );
}

/** New grid where each cell shows the largest count within a horizontal window of `width` cells. */
function dppWidenColumns( grid, width )
{
   const counts = Uint32Array.from( grid.counts );
   if ( width > 1 )
   {
      const left = Math.floor( ( width - 1 ) / 2 ), right = width - 1 - left;
      for ( let y = 0; y < grid.height; ++y )
         for ( let x = 0; x < grid.width; ++x )
         {
            let m = 0;
            for ( let k = Math.max( 0, x - left ); k <= Math.min( grid.width - 1, x + right ); ++k )
               m = Math.max( m, grid.counts[ y * grid.width + k ] );
            counts[ y * grid.width + x ] = m;
         }
   }
   return { counts: counts, width: grid.width, height: grid.height, max: grid.max };
}

/** Smallest positive step between distinct values (0 when all are equal). */
function dppQuantum( values )
{
   const stride = dppStride( values.length, 200000 );
   const sample = [];
   for ( let i = 0; i < values.length; i += stride )
      sample.push( values[ i ] );
   const sorted = Float64Array.from( sample ).sort();
   let q = Infinity;
   for ( let i = 1; i < sorted.length; ++i )
   {
      const d = sorted[ i ] - sorted[ i - 1 ];
      if ( d > 1e-9 && d < q )
         q = d;
   }
   return Number.isFinite( q ) ? Math.round( q * 1e6 ) / 1e6 : 0;
}

/** Sequential blue ramp, t in [0, 1] -> [r, g, b] in [0, 255]. */
function dppRampColor( t )
{
   const u = Math.max( 0, Math.min( 1, t ) ) * ( DPP_RAMP.length - 1 );
   const i = Math.min( DPP_RAMP.length - 2, Math.floor( u ) ), f = u - i;
   return DPP_RAMP[ i ].map( ( c, k ) => Math.round( c + ( DPP_RAMP[ i + 1 ][ k ] - c ) * f ) );
}

function dppFormatInt( n )
{
   return Math.round( n ).toString().replace( /\B(?=(\d{3})+(?!\d))/g, "," );
}

function dppPercentile( values, p )
{
   const stride = dppStride( values.length, 400000 );
   const sample = [];
   for ( let i = 0; i < values.length; i += stride )
      if ( Number.isFinite( values[ i ] ) )
         sample.push( values[ i ] );
   const sorted = Float64Array.from( sample ).sort();
   return sorted[ Math.min( sorted.length - 1, Math.max( 0, Math.round( p / 100 * ( sorted.length - 1 ) ) ) ) ];
}

if ( typeof module !== "undefined" && module.exports )
   module.exports = {
      dppPixelStats, dppLowerLevel, dppNoiseModel, dppModelTypical, dppModelCurve, dppDashSegments, dppClassify, dppAxis, dppLogTicks, dppLinearTicks,
      dppDecadeTicks, dppDecadeLabel, dppYRange,
      dppDensityGrid, dppAlignedZoom, dppColumnWidth, dppWidenColumns, dppQuantum, dppRampColor, dppFormatInt, dppPercentile
   };
