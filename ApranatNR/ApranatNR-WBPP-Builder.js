// ----------------------------------------------------------------------------
// ApranatNR-WBPP-Builder.js - WBPP pipeline builder (GENERATED FILE, DO NOT EDIT)
//
// Use: WBPP > Pipeline > Pipeline builder: enable it and select this file.
// Settings: ApranatNR-WBPP-Settings.json in the same folder.
// Generated from ApranatNR-Version.js, ApranatNR-Core.js, ApranatNR-IO.js, ApranatNR-Engine.js, ApranatNR-WBPP.js by
// tools/build-wbpp-builder.js; edit those files and run the tool again.
// ----------------------------------------------------------------------------
// ==== ApranatNR-Version.js ====
// ----------------------------------------------------------------------------
// ApranatNR-Version.js - product name and version (single source).
//
// Plain constants (no #define): the file is #included by the standalone script
// and bundled into the WBPP pipeline builder.
// ----------------------------------------------------------------------------

const ANR_TITLE = "ApranatNR";
const ANR_VERSION = "1.6.0";

// ==== ApranatNR-Core.js ====
// ----------------------------------------------------------------------------
// ApranatNR-Core.js
//
// Pure numerical core of ApranatNR (no PJSR dependencies, testable in Node).
// Implements the preprocessing ideas published by "あぷらなーと":
//   - Cool file correction   https://apranat.exblog.jp/28135658/
//   - Cosmicut composite     https://apranat.exblog.jp/31257871/
//   - Software pixel mapping of "drunk" (RTN) pixels
//                            https://apranat.exblog.jp/32142709/
// All images are single-channel Float32Array planes, row-major.
// ----------------------------------------------------------------------------

const ANR_MAD_TO_SIGMA = 1.4826;
const ANR_MIN_NEIGHBORS = 3;
const ANR_MAX_STAT_SAMPLES = 1000000;
// A cool pixel must sit on a flat neighborhood: the spread of its neighbors
// (ignoring the brightest and darkest one) must stay below this many sigmas.
const ANR_STRUCTURE_SPREAD_SIGMAS = 5;
// RTN repair is skipped where it would move a pixel by more than this many
// residual sigmas: an RTN jump rarely gets that large, a star core always does.
const ANR_RTN_PROTECT_SIGMAS = 5;
// RTN repair is also skipped where the unregistered average of the raw
// calibrated frames is brighter than its same-color neighbors by more than
// this many robust sigmas of that stack: structure that stays on the same
// pixels (undithered data), like a faint star the per-frame limit cannot see
const ANR_STACK_PROTECT_SIGMAS = 5;
// ... or where the 8 adjacent pixels (any color) are brighter than their own
// same-color neighbors in that stack, together, by more than this many
// sigmas: a star's footprint, which an RTN residual (one pixel) does not have
const ANR_STACK_FOOTPRINT_SIGMAS = 3;
const ANR_REPAIR_SIGMA_SAMPLES = 200000;
const ANR_NEIGHBOR_OFFSETS = [ [ -1, -1 ], [ 0, -1 ], [ 1, -1 ], [ -1, 0 ], [ 1, 0 ], [ -1, 1 ], [ 0, 1 ], [ 1, 1 ] ];

function anrAssertSameLength( a, b, what )
{
   if ( a.length !== b.length )
      throw new Error( what + ": size mismatch (" + a.length + " vs " + b.length + ")" );
}

/**
 * Sorts the first n entries of buf in place and returns their median.
 * @param {Float64Array} buf
 * @param {number} n
 * @returns {number}
 */
function anrMedianInPlace( buf, n )
{
   for ( let i = 1; i < n; ++i )
   {
      const v = buf[ i ];
      let j = i - 1;
      for ( ; j >= 0 && buf[ j ] > v; --j )
         buf[ j + 1 ] = buf[ j ];
      buf[ j + 1 ] = v;
   }
   const h = n >> 1;
   return ( n & 1 ) ? buf[ h ] : 0.5 * ( buf[ h - 1 ] + buf[ h ] );
}

function anrSortedMedian( sorted )
{
   const n = sorted.length;
   const h = n >> 1;
   return ( n & 1 ) ? sorted[ h ] : 0.5 * ( sorted[ h - 1 ] + sorted[ h ] );
}

/**
 * Robust location (median) and scale (1.4826*MAD) of the finite values,
 * estimated on an evenly strided subsample of at most maxSamples values.
 * @param {ArrayLike<number>} values
 * @param {number} maxSamples
 * @returns {{median: number, sigma: number}}
 */
function anrRobustLocationScale( values, maxSamples )
{
   // An odd stride cannot lock onto a single parity of columns (CFA phase).
   let stride = Math.max( 1, Math.ceil( values.length / maxSamples ) );
   if ( stride > 1 && stride % 2 === 0 )
      ++stride;
   const picked = [];
   for ( let i = 0; i < values.length; i += stride )
      if ( Number.isFinite( values[ i ] ) )
         picked.push( values[ i ] );
   if ( picked.length === 0 )
      return { median: 0, sigma: 0 };

   const sample = Float64Array.from( picked ).sort();
   const median = anrSortedMedian( sample );
   const deviations = sample.map( v => Math.abs( v - median ) ).sort();
   return { median: median, sigma: ANR_MAD_TO_SIGMA * anrSortedMedian( deviations ) };
}

/**
 * Median of the 8 neighbors of (x,y) at distance `step` (1: mono, 2: Bayer CFA,
 * i.e. same-color pixels). Neighbors outside the image or flagged in `mask`
 * are skipped. Returns NaN when fewer than ANR_MIN_NEIGHBORS are usable.
 */
function anrGatherNeighbors( data, width, height, x, y, step, mask, buf )
{
   let n = 0;
   for ( let k = 0; k < 8; ++k )
   {
      const nx = x + ANR_NEIGHBOR_OFFSETS[ k ][ 0 ] * step;
      const ny = y + ANR_NEIGHBOR_OFFSETS[ k ][ 1 ] * step;
      if ( nx < 0 || ny < 0 || nx >= width || ny >= height )
         continue;
      const j = ny * width + nx;
      if ( mask && mask[ j ] )
         continue;
      buf[ n++ ] = data[ j ];
   }
   return n;
}

function anrNeighborMedian( data, width, height, x, y, step, mask, buf )
{
   const n = anrGatherNeighbors( data, width, height, x, y, step, mask, buf );
   return ( n < ANR_MIN_NEIGHBORS ) ? NaN : anrMedianInPlace( buf, n );
}

/**
 * For every pixel: residual against the same-color neighbor median, and the
 * neighbor spread (range without the brightest and darkest neighbor, so one
 * adjacent defect does not count as structure).
 */
function anrResidualMaps( stack, width, height, step )
{
   const residual = new Float32Array( stack.length );
   const spread = new Float32Array( stack.length );
   const buf = new Float64Array( 8 );
   for ( let y = 0; y < height; ++y )
      for ( let x = 0; x < width; ++x )
      {
         const i = y * width + x;
         const n = anrGatherNeighbors( stack, width, height, x, y, step, null, buf );
         if ( n < ANR_MIN_NEIGHBORS )
         {
            residual[ i ] = spread[ i ] = NaN;
            continue;
         }
         residual[ i ] = stack[ i ] - anrMedianInPlace( buf, n );
         spread[ i ] = ( n >= 4 ) ? buf[ n - 2 ] - buf[ 1 ] : buf[ n - 1 ] - buf[ 0 ];
      }
   return { residual: residual, spread: spread };
}

function anrPhaseValues( values, width, height, step, px, py )
{
   const out = new Float32Array( Math.ceil( ( width - px ) / step ) * Math.ceil( ( height - py ) / step ) );
   let n = 0;
   for ( let y = py; y < height; y += step )
      for ( let x = px; x < width; x += step )
         out[ n++ ] = values[ y * width + x ];
   return out;
}

/**
 * Ratio between the largest and smallest median of the four 2x2 phases.
 * Close to 1 for mono data; well above 1 for a Bayer CFA frame, which
 * reveals CFA data whose pattern metadata is missing.
 */
function anrCfaPhaseImbalance( stack, width, height )
{
   const medians = [];
   for ( let py = 0; py < 2; ++py )
      for ( let px = 0; px < 2; ++px )
         medians.push( anrRobustLocationScale( anrPhaseValues( stack, width, height, 2, px, py ), ANR_MAX_STAT_SAMPLES ).median );
   const lo = Math.min.apply( null, medians );
   const hi = Math.max.apply( null, medians );
   return ( lo > 0 ) ? hi / lo : ( hi > 0 ? Infinity : 1 );
}

/**
 * Builds the "cool file" from an unregistered average stack: for every pixel
 * darker than its same-color neighborhood by more than kSigma robust sigmas
 * (sigma estimated per CFA phase), stores the positive lift that brings it
 * to the neighborhood median. kSigma = 0 reproduces the original
 * "threshold zero" cool-pixel filter. With protectStructures, pixels whose
 * neighborhood is not flat (star wings and trails, nebula edges) are left
 * alone, since a dark pixel there is structure, not a defect.
 * @returns {{coolFile: Float32Array, correctedCount: number, protectedCount: number, sigmas: number[]}}
 */
function anrComputeCoolFile( stack, width, height, step, kSigma, protectStructures = true )
{
   if ( stack.length !== width * height )
      throw new Error( "computeCoolFile: stack size does not match geometry" );

   const { residual, spread } = anrResidualMaps( stack, width, height, step );
   const coolFile = new Float32Array( stack.length );
   const sigmas = [];
   let correctedCount = 0;
   let protectedCount = 0;

   for ( let py = 0; py < step; ++py )
      for ( let px = 0; px < step; ++px )
      {
         const stats = anrRobustLocationScale( anrPhaseValues( residual, width, height, step, px, py ), ANR_MAX_STAT_SAMPLES );
         // Never above zero, so k = 0 means exactly "darker than the neighbors".
         const threshold = Math.min( 0, stats.median ) - kSigma * stats.sigma;
         const maxSpread = ANR_STRUCTURE_SPREAD_SIGMAS * stats.sigma;
         sigmas.push( stats.sigma );
         for ( let y = py; y < height; y += step )
            for ( let x = px; x < width; x += step )
            {
               const i = y * width + x;
               const r = residual[ i ];
               if ( !( r < threshold ) )
                  continue;
               if ( protectStructures && !( spread[ i ] <= maxSpread ) )
               {
                  ++protectedCount;
                  continue;
               }
               coolFile[ i ] = -r;
               ++correctedCount;
            }
      }

   return { coolFile: coolFile, correctedCount: correctedCount, protectedCount: protectedCount, sigmas: sigmas };
}

/**
 * Returns frame + coolFile (plain addition, as specified by the method: the
 * cool file is added, not averaged, to every frame). Only corrected pixels
 * change; they are kept from rising above max(1, original value).
 */
function anrAddCoolFile( frame, coolFile )
{
   anrAssertSameLength( frame, coolFile, "addCoolFile" );
   const out = Float32Array.from( frame );
   for ( let i = 0; i < frame.length; ++i )
      if ( coolFile[ i ] > 0 )
         out[ i ] = Math.min( Math.max( 1, frame[ i ] ), frame[ i ] + coolFile[ i ] );
   return out;
}

class AnrMeanAccumulator
{
   constructor( length )
   {
      this.sum = new Float64Array( length );
      this.count = 0;
   }

   add( frame )
   {
      anrAssertSameLength( this.sum, frame, "MeanAccumulator" );
      for ( let i = 0; i < frame.length; ++i )
         this.sum[ i ] += frame[ i ];
      ++this.count;
   }

   mean()
   {
      if ( this.count < 1 )
         throw new Error( "MeanAccumulator: no frames added" );
      const inv = 1 / this.count;
      return Float32Array.from( this.sum, v => v * inv );
   }
}

/**
 * Per-pixel temporal statistics over a frame sequence. Besides the plain
 * mean/std, the "trimmed" variants drop each pixel's single highest and
 * lowest sample, so a one-off event (cosmic ray hit) does not make a pixel
 * look persistently noisy.
 */
class AnrTemporalStats
{
   constructor( length )
   {
      this.sum = new Float64Array( length );
      this.sumSq = new Float64Array( length );
      this.max = new Float32Array( length ).fill( -Infinity );
      this.min = new Float32Array( length ).fill( Infinity );
      this.count = 0;
   }

   add( frame )
   {
      anrAssertSameLength( this.sum, frame, "TemporalStats" );
      for ( let i = 0; i < frame.length; ++i )
      {
         const v = frame[ i ];
         this.sum[ i ] += v;
         this.sumSq[ i ] += v * v;
         if ( v > this.max[ i ] )
            this.max[ i ] = v;
         if ( v < this.min[ i ] )
            this.min[ i ] = v;
      }
      ++this.count;
   }

   static stdFrom( sum, sumSq, n )
   {
      return Math.sqrt( Math.max( 0, ( sumSq - sum * sum / n ) / ( n - 1 ) ) );
   }

   std()
   {
      const n = this.count;
      if ( n < 2 )
         throw new Error( "TemporalStats: at least two frames are required" );
      return Float32Array.from( this.sum, ( s, i ) => AnrTemporalStats.stdFrom( s, this.sumSq[ i ], n ) );
   }

   requireTrimmable()
   {
      if ( this.count < 4 )
         throw new Error( "TemporalStats: at least four frames are required for trimmed statistics" );
      return this.count - 2;
   }

   trimmedMean()
   {
      const n = this.requireTrimmable();
      return Float32Array.from( this.sum, ( s, i ) => ( s - this.max[ i ] - this.min[ i ] ) / n );
   }

   trimmedStd()
   {
      const n = this.requireTrimmable();
      return Float32Array.from( this.sum, ( s, i ) =>
      {
         const hi = this.max[ i ], lo = this.min[ i ];
         return AnrTemporalStats.stdFrom( s - hi - lo, this.sumSq[ i ] - hi * hi - lo * lo, n );
      } );
   }
}

// the shot-noise slope is measured on pixels at least this many read-noise
// units above the normal level: closer to it, the scatter of noisy pixels'
// own levels would be mistaken for dark current
const ANR_WARM_EXCESS_READS = 10;
// fewer warm pixels than this cannot give a slope: the model stays flat
const ANR_MIN_WARM_PIXELS = 50;
// half a 16-bit ADU: a smaller typical sigma is not meaningful (clipped or
// quantized darks) and would flag every pixel with any fluctuation
const ANR_MIN_TYPICAL_SIGMA = 0.5 / 65535;
// lower quartile of a normal distribution, in standard deviations below the mean
const ANR_LOWER_QUARTILE_Z = 0.6745;

/**
 * Dark level of each pixel for the noise model: an estimate of its lower
 * quartile, trimmed mean - 0.6745 x trimmed std (computable from running
 * sums). A pixel that jumps upward (two-level defects, flickering dark
 * current) keeps its normal low level, so its raised mean is not mistaken for
 * the dark current of a warm pixel.
 * @returns {Float32Array}
 */
function anrLowerQuartileLevel( mean, std )
{
   anrAssertSameLength( mean, std, "LowerQuartileLevel" );
   return Float32Array.from( mean, ( m, i ) => m - ANR_LOWER_QUARTILE_Z * std[ i ] );
}

/**
 * Expected temporal std as a function of the dark level, from the physics of
 * a dark frame: read noise plus the shot noise of the extra dark signal,
 *    typical(level)^2 = read^2 + slope * max(0, level - base).
 * base and read are the medians of level and std (almost all pixels are
 * normal); slope is the median of (std^2 - read^2) / (level - base) over the
 * warm pixels, well above the base level. A curve measured group by group
 * would instead be raised by the noisy pixels it should find wherever they
 * are numerous (off the normal level) and end below the brightest hot pixels.
 * @returns {{base: number, read: number, slope: number, warmPixels: number}}
 */
function anrNoiseModel( std, level, maxSamples )
{
   let stride = Math.max( 1, Math.ceil( std.length / maxSamples ) );
   if ( stride > 1 && stride % 2 === 0 )
      ++stride;
   const levels = [], stds = [];
   for ( let i = 0; i < std.length; i += stride )
      if ( Number.isFinite( std[ i ] ) && Number.isFinite( level[ i ] ) )
      {
         levels.push( level[ i ] );
         stds.push( std[ i ] );
      }
   if ( levels.length === 0 )
      throw new Error( "NoiseModel: no valid pixels" );
   const base = anrSortedMedian( Float64Array.from( levels ).sort() );
   const read = anrSortedMedian( Float64Array.from( stds ).sort() );
   // warm pixels are searched among all pixels (too rare for the sample above),
   // then at most maxSamples of them are used
   const minExcess = ANR_WARM_EXCESS_READS * read;
   const isWarm = i => level[ i ] - base > minExcess && Number.isFinite( level[ i ] ) && Number.isFinite( std[ i ] );
   let warmPixels = 0;
   for ( let i = 0; i < std.length; ++i )
      if ( isWarm( i ) )
         ++warmPixels;
   let warmStride = Math.max( 1, Math.ceil( warmPixels / maxSamples ) );
   if ( warmStride > 1 && warmStride % 2 === 0 )
      ++warmStride;
   const slopes = [];
   for ( let i = 0, k = 0; i < std.length; ++i )
      if ( isWarm( i ) && k++ % warmStride === 0 )
         slopes.push( ( std[ i ] * std[ i ] - read * read ) / ( level[ i ] - base ) );
   const slope = ( warmPixels >= ANR_MIN_WARM_PIXELS ) ? Math.max( 0, anrSortedMedian( Float64Array.from( slopes ).sort() ) ) : 0;
   return { base: base, read: read, slope: slope, warmPixels: warmPixels };
}

function anrModelTypical( model, level )
{
   return ( model.slope > 0 ) ? Math.sqrt( model.read * model.read + model.slope * Math.max( 0, level - model.base ) ) : model.read;
}

/**
 * Flags "drunk" pixels: temporal std above ratio x the typical std. With
 * `level` (per-pixel dark level), the typical std is the one expected at that
 * level from read noise and dark-current shot noise (anrNoiseModel), so warm
 * and hot pixels whose extra noise is just their shot noise are not flagged
 * (the article's criterion: same median, abnormal spread). Without it, the
 * global median std is used.
 * @returns {{mask: Uint8Array, count: number, medianStd: number, threshold: number, model: object|null}}
 */
function anrDetectNoisyPixels( std, ratio, level = null )
{
   const medianStd = anrRobustLocationScale( std, ANR_MAX_STAT_SAMPLES ).median;
   const model = level ? anrNoiseModel( std, level, ANR_MAX_STAT_SAMPLES ) : null;
   const mask = new Uint8Array( std.length );
   let count = 0;
   for ( let i = 0; i < std.length; ++i )
   {
      const typical = Math.max( ANR_MIN_TYPICAL_SIGMA, model ? anrModelTypical( model, level[ i ] ) : medianStd );
      if ( std[ i ] > ratio * typical )
      {
         mask[ i ] = 1;
         ++count;
      }
   }
   return { mask: mask, count: count, medianStd: medianStd, threshold: ratio * medianStd, model: model };
}

/**
 * Robust sigma of (pixel - median of its unflagged same-color neighbors) for
 * each CFA phase (index py * step + px), estimated on an evenly strided
 * sample of at most maxSamples unflagged pixels per phase.
 * @returns {number[]}
 */
function anrResidualSigmas( frame, width, height, step, mask, maxSamples )
{
   const buf = new Float64Array( 8 );
   const sigmas = [];
   for ( let py = 0; py < step; ++py )
      for ( let px = 0; px < step; ++px )
      {
         const cols = Math.ceil( ( width - px ) / step );
         const total = cols * Math.ceil( ( height - py ) / step );
         let stride = Math.max( 1, Math.ceil( total / maxSamples ) );
         if ( stride > 1 && stride % 2 === 0 )
            ++stride;
         const residuals = [];
         for ( let k = 0; k < total; k += stride )
         {
            const x = px + ( k % cols ) * step;
            const y = py + Math.floor( k / cols ) * step;
            const i = y * width + x;
            if ( mask && mask[ i ] )
               continue;
            const m = anrNeighborMedian( frame, width, height, x, y, step, mask, buf );
            if ( !Number.isNaN( m ) )
               residuals.push( frame[ i ] - m );
         }
         sigmas.push( anrRobustLocationScale( residuals, residuals.length ).sigma );
      }
   return sigmas;
}

/**
 * Replaces every pixel flagged in mask by the median of its unflagged
 * same-color neighbors. Pixels without enough clean neighbors are kept.
 * With protectStructures, a pixel is also kept when the replacement would
 * move it by more than ANR_RTN_PROTECT_SIGMAS residual sigmas of its CFA
 * phase: that happens under a star core (the neighbors 1-2 px away are always
 * fainter, so the median would dim the star in every frame of an undithered
 * sequence), while an RTN jump stays within a few sigmas. A huge one-frame
 * outlier on a defect is kept too and left to pixel rejection. Without a noise
 * scale (sigma 0, e.g. noise-free data) nothing is protected, and non-finite
 * defect values are always replaced.
 * @returns {{data: Float32Array, repaired: number, unrepaired: number, protectedCount: number}}
 */
function anrRepairDefects( frame, width, height, mask, step, protectStructures = true, keep = null )
{
   anrAssertSameLength( frame, mask, "repairDefects" );
   if ( keep )
      anrAssertSameLength( frame, keep, "repairDefects" );
   const data = Float32Array.from( frame );
   const buf = new Float64Array( 8 );
   const limits = protectStructures
      ? anrResidualSigmas( frame, width, height, step, mask, ANR_REPAIR_SIGMA_SAMPLES )
           .map( s => ( s > 0 ) ? ANR_RTN_PROTECT_SIGMAS * s : Infinity )
      : null;
   let repaired = 0;
   let unrepaired = 0;
   let protectedCount = 0;
   let stackKept = 0;
   for ( let i = 0; i < mask.length; ++i )
   {
      if ( !mask[ i ] )
         continue;
      // a non-finite value is always replaced, whatever the stack shows
      if ( keep && keep[ i ] && Number.isFinite( frame[ i ] ) )
      {
         ++stackKept;
         continue;
      }
      const x = i % width;
      const y = Math.floor( i / width );
      const m = anrNeighborMedian( frame, width, height, x, y, step, mask, buf );
      if ( Number.isNaN( m ) )
         ++unrepaired;
      else if ( limits && Number.isFinite( frame[ i ] ) &&
                !( Math.abs( frame[ i ] - m ) <= limits[ ( y % step ) * step + ( x % step ) ] ) )
         ++protectedCount;
      else
      {
         data[ i ] = m;
         ++repaired;
      }
   }
   return { data: data, repaired: repaired, unrepaired: unrepaired, protectedCount: protectedCount, stackKept: stackKept };
}

/**
 * Map pixels to leave unrepaired because the unregistered stack of the raw
 * (unrepaired) calibrated frames shows a star on them. In undithered data a
 * faint star stays on the same pixels: buried in each frame's noise, it
 * stands out in the stack. Two tests, in units of the stack's residual sigma
 * (per CFA phase, from a sample of unflagged pixels, anrResidualSigmas):
 *  - own excess: the pixel is brighter than its same-color neighbor median by
 *    more than kSigma;
 *  - footprint: its 8 adjacent pixels (any color, unflagged) are brighter than
 *    their own same-color neighbor medians, together, by more than
 *    kFootprint (sum of their residuals, each capped at 2 x kFootprint, /
 *    sqrt(count)). A star spreads over
 *    adjacent pixels; an RTN pixel's residual (its mean differs between the
 *    darks and the lights) stays on one pixel.
 * Darker map pixels are never kept.
 * @returns {{keep: Uint8Array, count: number, ownCount: number, footprintCount: number, sigmas: number[]}}
 */
function anrStackStructureMask( stack, width, height, step, mask, kSigma, kFootprint )
{
   anrAssertSameLength( stack, mask, "stackStructureMask" );
   if ( stack.length !== width * height )
      throw new Error( "stackStructureMask: size mismatch (stack vs geometry)" );
   const sigmas = anrResidualSigmas( stack, width, height, step, mask, ANR_REPAIR_SIGMA_SAMPLES );
   const buf = new Float64Array( 8 );
   // residual of pixel (x, y) in sigmas of its phase; NaN when unknown
   const zAt = ( x, y ) =>
   {
      const sigma = sigmas[ ( y % step ) * step + ( x % step ) ];
      return ( sigma > 0 ) ? ( stack[ y * width + x ] - anrNeighborMedian( stack, width, height, x, y, step, mask, buf ) ) / sigma : NaN;
   };
   const keep = new Uint8Array( stack.length );
   let ownCount = 0, footprintCount = 0;
   for ( let i = 0; i < mask.length; ++i )
   {
      if ( !mask[ i ] )
         continue;
      const x = i % width;
      const y = ( i - x ) / width;
      if ( zAt( x, y ) > kSigma )
      {
         keep[ i ] = 1;
         ++ownCount;
         continue;
      }
      let sum = 0, n = 0;
      for ( const [ dx, dy ] of ANR_NEIGHBOR_OFFSETS )   // the 8 adjacent pixels
      {
         const ax = x + dx, ay = y + dy;
         if ( ax < 0 || ay < 0 || ax >= width || ay >= height || mask[ ay * width + ax ] )
            continue;
         const z = zAt( ax, ay );
         if ( Number.isFinite( z ) )
         {
            // one bright neighbor (an unmapped hot pixel) cannot make a footprint alone
            sum += Math.min( z, 2 * kFootprint );
            ++n;
         }
      }
      if ( n >= ANR_MIN_NEIGHBORS && sum / Math.sqrt( n ) > kFootprint )
      {
         keep[ i ] = 1;
         ++footprintCount;
      }
   }
   return { keep: keep, count: ownCount + footprintCount, ownCount: ownCount, footprintCount: footprintCount, sigmas: sigmas };
}

/**
 * Streaming "Cosmicut" composite: (sum - max) / (n - 1) per pixel, i.e. an
 * average that always discards the single brightest sample. Only the sum,
 * the running maximum and (optionally) a valid-sample counter are kept in
 * memory, never the whole stack. Non-finite samples are always skipped; with
 * excludeZero, values <= 0 are also treated as "no data" (registration
 * borders), like ImageIntegration's low range clipping.
 */
class AnrCosmicutAccumulator
{
   constructor( length, excludeZero )
   {
      this.excludeZero = excludeZero;
      this.sum = new Float64Array( length );
      this.max = new Float32Array( length ).fill( -Infinity );
      this.valid = new Uint16Array( length );
      this.count = 0;
   }

   add( frame )
   {
      anrAssertSameLength( this.sum, frame, "CosmicutAccumulator" );
      for ( let i = 0; i < frame.length; ++i )
      {
         const v = frame[ i ];
         if ( !Number.isFinite( v ) || ( this.excludeZero && v <= 0 ) )
            continue;
         ++this.valid[ i ];
         this.sum[ i ] += v;
         if ( v > this.max[ i ] )
            this.max[ i ] = v;
      }
      ++this.count;
   }

   result()
   {
      if ( this.count < 2 )
         throw new Error( "Cosmicut: at least two frames are required" );
      const out = new Float32Array( this.sum.length );
      for ( let i = 0; i < out.length; ++i )
      {
         const n = this.valid[ i ];
         if ( n >= 2 )
            out[ i ] = ( this.sum[ i ] - this.max[ i ] ) / ( n - 1 );
         else if ( n === 1 )
            out[ i ] = this.sum[ i ];
      }
      return out;
   }

   maxImage()
   {
      return Float32Array.from( this.max, v => Number.isFinite( v ) ? v : 0 );
   }
}

function anrBaseName( filePath )
{
   return filePath.replace( /^.*[\\/]/, "" ).replace( /\.[^.]*$/, "" );
}

/**
 * Plans one output path per source file. A planned path never equals a
 * source path or another planned path, and never an existing file unless
 * overwrite is set; collisions get a _1, _2 ... suffix.
 * @param {(path: string) => boolean} exists
 * @returns {string[]}
 */
function anrPlanOutputPaths( sources, outDir, suffix, extension, overwrite, exists )
{
   const key = path => path.toLowerCase();
   const dir = outDir.replace( /[\\/]+$/, "" );
   const reserved = new Set( sources.map( key ) );
   return sources.map( source =>
   {
      const base = dir + "/" + anrBaseName( source ) + suffix;
      let path = base + extension;
      for ( let u = 1; reserved.has( key( path ) ) || ( !overwrite && exists( path ) ); ++u )
         path = base + "_" + u + extension;
      reserved.add( key( path ) );
      return path;
   } );
}

if ( typeof module !== "undefined" && module.exports )
   module.exports = {
      ANR_MAD_TO_SIGMA,
      anrCfaPhaseImbalance,
      anrPlanOutputPaths,
      anrMedianInPlace,
      anrRobustLocationScale,
      anrNeighborMedian,
      anrComputeCoolFile,
      anrAddCoolFile,
      AnrMeanAccumulator,
      AnrTemporalStats,
      anrLowerQuartileLevel,
      anrNoiseModel,
      anrModelTypical,
      anrDetectNoisyPixels,
      anrResidualSigmas,
      anrRepairDefects,
      anrStackStructureMask,
      AnrCosmicutAccumulator
   };

// ==== ApranatNR-IO.js ====
// ----------------------------------------------------------------------------
// ApranatNR-IO.js - image file I/O preserving FITS keywords / XISF properties
// ----------------------------------------------------------------------------

// Plain constants (no #define): this file is also bundled into the WBPP
// pipeline builder, where the PJSR preprocessor does not run.
// "raw cfa": camera raw files (CR2, NEF, ARW...) are read as the undebayered
// sensor data, like WBPP does; FITS and XISF ignore these hints
const ANR_IO_HINTS = "non-interactive raw cfa";
const ANR_OUTPUT_EXT = ".xisf";
const ANR_CFA_PROPERTY = "PCL:CFASourcePattern";
const ANR_BAYER_KEYWORD = "BAYERPAT";

function anrCheckAbort()
{
   CoreApplication.processEvents();
   if ( console.abortRequested )
      throw new Error( "<* abort *>" );
}

function anrReadProperties( format, instance )
{
   if ( !( format.canStoreImageProperties && format.supportsViewProperties ) )
      return [];
   const properties = [];
   const list = instance.imageProperties;
   for ( let i = 0; i < list.length; ++i )
   {
      const value = instance.readImageProperty( list[ i ][ 0 ] );
      if ( value != null )
         properties.push( { id: list[ i ][ 0 ], type: list[ i ][ 1 ], value: value } );
   }
   return properties;
}

/**
 * Reads an image file as 32-bit float planes.
 * @returns {{filePath: string, width: number, height: number, planes: Float32Array[],
 *            keywords: FITSKeyword[], properties: object[], description: ImageDescription}}
 */
function anrReadFrame( filePath )
{
   const suffix = File.extractExtension( filePath ).toLowerCase();
   const format = new FileFormat( suffix, true/*toRead*/, false/*toWrite*/ );
   if ( format.isNull )
      throw new Error( "No installed file format can read '" + suffix + "' files: " + filePath );

   const instance = new FileFormatInstance( format );
   if ( instance.isNull )
      throw new Error( "Unable to instantiate file format: " + format.name );

   const descriptions = instance.open( filePath, ANR_IO_HINTS );
   if ( !descriptions || descriptions.length < 1 )
      throw new Error( "Unable to open file: " + filePath );

   const image = new Image( 1, 1, 1, ColorSpace.Gray, 32, PixelSampleType.Float );
   try
   {
      if ( descriptions.length > 1 )
         throw new Error( "Multi-image files are not supported: " + filePath );
      if ( !instance.readImage( image ) )
         throw new Error( "Unable to read file: " + filePath );

      const width = image.width;
      const height = image.height;
      const planes = [];
      for ( let c = 0; c < image.numberOfChannels; ++c )
      {
         const plane = new Float32Array( width * height );
         image.getSamples( plane, new Rect( 0, 0, width, height ), c );
         planes.push( plane );
      }

      return {
         filePath: filePath,
         width: width,
         height: height,
         planes: planes,
         keywords: format.canStoreKeywords ? instance.keywords : [],
         properties: anrReadProperties( format, instance ),
         description: descriptions[ 0 ]
      };
   }
   finally
   {
      instance.close();
      image.free();
   }
}

function anrHistoryKeywords( lines )
{
   return lines.map( text => new FITSKeyword( "HISTORY", "", text ) );
}

/**
 * Writes float planes as a 32-bit float XISF file.
 * meta: { keywords?, properties?, description? } copied from a source frame.
 */
function anrWriteImage( filePath, planes, width, height, meta, historyLines )
{
   const channels = planes.length;
   const image = new Image( width, height, channels,
                            ( channels === 3 ) ? ColorSpace.RGB : ColorSpace.Gray,
                            32, PixelSampleType.Float );
   try
   {
      for ( let c = 0; c < channels; ++c )
         image.setSamples( planes[ c ], new Rect( 0, 0, width, height ), c );

      const format = new FileFormat( ANR_OUTPUT_EXT, false/*toRead*/, true/*toWrite*/ );
      if ( format.isNull )
         throw new Error( "The XISF file format is not available." );
      const instance = new FileFormatInstance( format );
      if ( instance.isNull )
         throw new Error( "Unable to instantiate file format: " + format.name );
      if ( !instance.create( filePath, ANR_IO_HINTS ) )
         throw new Error( "Error creating output file: " + filePath );

      try
      {
         const description = meta.description ? new ImageDescription( meta.description ) : new ImageDescription;
         description.bitsPerSample = 32;
         description.ieeefpSampleFormat = true;
         if ( !instance.setOptions( description ) )
            throw new Error( "Unable to set output file options: " + filePath );

         instance.keywords = ( meta.keywords || [] ).concat( anrHistoryKeywords( historyLines ) );
         ( meta.properties || [] ).forEach( p => instance.writeImageProperty( p.id, p.value, p.type ) );

         if ( !instance.writeImage( image ) )
            throw new Error( "Error writing output file: " + filePath );
      }
      finally
      {
         instance.close();
      }
   }
   finally
   {
      image.free();
   }
}

function anrEnsureDirectory( dirPath )
{
   if ( !File.directoryExists( dirPath ) )
      File.createDirectory( dirPath, true/*createIntermediateDirectories*/ );
   return dirPath;
}

function anrOutputPath( dirPath, baseName, overwrite )
{
   const path = dirPath + "/" + baseName + ANR_OUTPUT_EXT;
   if ( overwrite || !File.exists( path ) )
      return path;
   for ( let u = 1; ; ++u )
   {
      const candidate = dirPath + "/" + baseName + "_" + u + ANR_OUTPUT_EXT;
      if ( !File.exists( candidate ) )
         return candidate;
   }
}

function anrDirectoryOf( filePath )
{
   return File.extractDrive( filePath ) + File.extractDirectory( filePath );
}

/**
 * True when a single-channel frame carries a Bayer CFA pattern (XISF property
 * or BAYERPAT keyword). Already debayered (RGB) frames are never CFA.
 */
function anrFrameLooksCfa( frame )
{
   if ( frame.planes.length !== 1 )
      return false;
   if ( frame.properties.some( p => p.id === ANR_CFA_PROPERTY ) )
      return true;
   return frame.keywords.some( k => k.name.trim().toUpperCase() === ANR_BAYER_KEYWORD );
}

// ==== ApranatNR-Engine.js ====
// ----------------------------------------------------------------------------
// ApranatNR-Engine.js - processing pipeline
//
// Stage A (calibrated, NOT registered frames):
//    [RTN "drunk" pixel mapping] -> [cool file correction] -> corrected frames
// Stage B (registered frames):
//    Cosmicut composite = (sum - max) / (n - 1)
// ----------------------------------------------------------------------------

const ANR_CFA_AUTO = 0;
const ANR_CFA_MONO = 1;
const ANR_CFA_BAYER = 2;

const ANR_MIN_COOL_FRAMES = 2;
const ANR_RECOMMENDED_COOL_FRAMES = 10;
const ANR_MIN_DARK_FRAMES = 8;
const ANR_MIN_COSMICUT_FRAMES = 3;
const ANR_DEFAULT_SUBDIR = "ApranatNR";
// broken darks (saturated, clipped) flag far more; real RTN maps reach about
// 1.2% at high gain (ASI533MC Pro, Gain 400-460)
const ANR_MAX_DEFECT_FRACTION = 0.03;
const ANR_CFA_IMBALANCE_WARNING = 1.15;
// stars cover well under 1% of the map; far more kept pixels means the RTN
// pixels' mean differs between the darks and the lights
const ANR_STACK_KEEP_WARNING = 0.05;

class AnrParameters
{
   lightFiles = [];
   darkFiles = [];
   registeredFiles = [];

   cfaMode = ANR_CFA_AUTO;

   rtnEnabled = false;
   rtnDefectMapPath = "";
   rtnRatio = 4.0;
   rtnProtectStructures = true;

   coolEnabled = true;
   coolSigma = 5.0;
   coolProtectStructures = true;

   outputDir = "";
   outputSuffix = "_anr";
   overwrite = false;

   cosmicutExcludeZero = true;
   cosmicutSaveMax = false;
   cosmicutOutputDir = "";
   cosmicutMasterName = "master_cosmicut";
   cosmicutMaxName = "cosmicut_rejected_max";
}

function anrHeader( text )
{
   console.noteln( "<end><cbr><br>* " + ANR_TITLE + ": " + text );
}

function anrInfo( text )
{
   console.writeln( "<end><cbr><raw>" + text + "</raw>" );
}

function anrHistory( text )
{
   return ANR_TITLE + " " + ANR_VERSION + ": " + text;
}

function anrGeometryOf( frame )
{
   return { width: frame.width, height: frame.height, channels: frame.planes.length };
}

function anrCheckGeometry( frame, geom )
{
   if ( frame.width !== geom.width || frame.height !== geom.height || frame.planes.length !== geom.channels )
      throw new Error( format( "Image geometry mismatch (%dx%dx%d, expected %dx%dx%d): ",
                               frame.width, frame.height, frame.planes.length,
                               geom.width, geom.height, geom.channels ) + frame.filePath );
}

function anrResolveStep( cfaMode, frame )
{
   if ( cfaMode === ANR_CFA_MONO )
      return 1;
   if ( cfaMode === ANR_CFA_BAYER )
   {
      if ( frame.planes.length !== 1 )
         throw new Error( "Bayer CFA mode requires single-channel (not debayered) frames: " + frame.filePath );
      return 2;
   }
   return anrFrameLooksCfa( frame ) ? 2 : 1;
}

function anrResolveOutputDir( explicitDir, files )
{
   const dir = ( explicitDir.length > 0 ) ? explicitDir : anrDirectoryOf( files[ 0 ] ) + "/" + ANR_DEFAULT_SUBDIR;
   return anrEnsureDirectory( dir );
}

function anrSourceMeta( frame )
{
   return { keywords: frame.keywords, properties: frame.properties, description: frame.description };
}

// ---------------------------------------------------------------------------
// RTN ("drunk") pixel mapping
// ---------------------------------------------------------------------------

function anrValidateDefectCount( count, total, hint )
{
   if ( count > ANR_MAX_DEFECT_FRACTION * total )
      throw new Error( format( "%d defective pixels (%.2f%%) exceed the %.0f%% safety limit; ",
                               count, 100 * count / total, 100 * ANR_MAX_DEFECT_FRACTION ) + hint );
}

function anrLoadDefectMap( filePath, geom )
{
   const frame = anrReadFrame( filePath );
   if ( frame.width !== geom.width || frame.height !== geom.height )
      throw new Error( "Defect map size does not match the light frames: " + filePath );
   const mask = Uint8Array.from( frame.planes[ 0 ], v => ( v > 0.5 ) ? 1 : 0 );
   const count = mask.reduce( ( a, v ) => a + v, 0 );
   anrValidateDefectCount( count, mask.length, "this does not look like an RTN defect map." );
   anrInfo( format( "Defect map loaded: %d defective pixels", count ) );
   return mask;
}

function anrDefectMaskFromDarks( p, geom, outDir )
{
   if ( p.darkFiles.length < ANR_MIN_DARK_FRAMES )
      throw new Error( format( "At least %d individual dark frames are required to detect RTN pixels.", ANR_MIN_DARK_FRAMES ) );

   const stats = new AnrTemporalStats( geom.width * geom.height );
   p.darkFiles.forEach( ( path, i ) =>
   {
      anrCheckAbort();
      anrInfo( format( "Dark %d/%d: ", i + 1, p.darkFiles.length ) + path );
      const dark = anrReadFrame( path );
      if ( dark.width !== geom.width || dark.height !== geom.height || dark.planes.length !== 1 )
         throw new Error( "Dark frame geometry does not match the light frames: " + path );
      stats.add( dark.planes[ 0 ] );
   } );

   const trimmedStd = stats.trimmedStd();
   const detection = anrDetectNoisyPixels( trimmedStd, p.rtnRatio, anrLowerQuartileLevel( stats.trimmedMean(), trimmedStd ) );
   const model = detection.model;
   anrInfo( format( "RTN pixels: %d (%.4f%%), median trimmed temporal sigma = %.3e; " +
                    "criterion: sigma > %.2f x expected sigma at its lower-quartile dark level (max/min sample excluded)",
                    detection.count, 100 * detection.count / detection.mask.length,
                    detection.medianStd, p.rtnRatio ) );
   anrInfo( format( "Expected sigma^2 = %.3e^2 + %.3e x (level - %.5f): read noise + dark-current shot noise, slope from %d warm pixels",
                    model.read, model.slope, model.base, model.warmPixels ) );
   if ( model.slope === 0 )
      console.warningln( "** Warning: too few warm pixels to measure the shot noise: hot pixels may be flagged as RTN pixels." );
   anrValidateDefectCount( detection.count, detection.mask.length,
                           "raise the std-dev ratio threshold or check the dark frames (clipped or quantized data?)." );

   const mapPath = anrOutputPath( outDir, "rtn_defect_map", p.overwrite );
   anrWriteImage( mapPath, [ Float32Array.from( detection.mask ) ], geom.width, geom.height, {},
                  [ anrHistory( format( "RTN defect map from %d darks, ratio %.2f vs read + shot noise model, trimmed", p.darkFiles.length, p.rtnRatio ) ) ] );
   anrInfo( "Defect map written: " + mapPath );
   return detection.mask;
}

function anrBuildDefectMask( p, geom, outDir )
{
   anrHeader( "RTN (drunk) pixel mapping" );
   if ( geom.channels !== 1 )
      throw new Error( "RTN pixel mapping must be applied to single-channel frames before debayering." );
   return ( p.rtnDefectMapPath.length > 0 ) ? anrLoadDefectMap( p.rtnDefectMapPath, geom )
                                            : anrDefectMaskFromDarks( p, geom, outDir );
}

function anrPreparePlanes( frame, geom, step, mask, protectStructures, keep = null )
{
   anrCheckGeometry( frame, geom );
   if ( !mask )
      return { planes: frame.planes, repaired: 0, kept: 0, stackKept: 0 };
   const result = anrRepairDefects( frame.planes[ 0 ], geom.width, geom.height, mask, step, protectStructures, keep );
   return { planes: [ result.data ], repaired: result.repaired, kept: result.protectedCount + result.stackKept, stackKept: result.stackKept };
}

/**
 * One pass over the lights: unregistered stack of the raw calibrated frames
 * (for the stack protection; the brightest sample of each pixel is dropped,
 * so a single cosmic-ray hit does not look like a star) and/or average of the
 * RTN-repaired frames (for the cool file; per-frame protection only, which is
 * enough there because the cool file only concerns pixels darker than their
 * neighbors).
 * @returns {{raw: Float32Array[]|null, repaired: Float32Array[]|null}}
 */
function anrStackLights( p, geom, step, mask, wantRaw, wantRepaired )
{
   anrHeader( "Unregistered average stack" );
   const pixels = geom.width * geom.height;
   const robust = p.lightFiles.length >= 2;
   const raw = wantRaw ? [ robust ? new AnrCosmicutAccumulator( pixels, false ) : new AnrMeanAccumulator( pixels ) ] : null;
   const repaired = wantRepaired ? Array.from( { length: geom.channels }, () => new AnrMeanAccumulator( pixels ) ) : null;
   p.lightFiles.forEach( ( path, i ) =>
   {
      anrCheckAbort();
      anrInfo( format( "Stacking %d/%d: ", i + 1, p.lightFiles.length ) + path );
      const frame = anrReadFrame( path );
      anrCheckGeometry( frame, geom );
      if ( raw )
         raw[ 0 ].add( frame.planes[ 0 ] );
      if ( repaired )
         anrPreparePlanes( frame, geom, step, mask, p.rtnProtectStructures ).planes.forEach( ( plane, c ) => repaired[ c ].add( plane ) );
   } );
   return { raw: raw ? raw.map( a => robust ? a.result() : a.mean() ) : null, repaired: repaired ? repaired.map( a => a.mean() ) : null };
}

function anrStackProtection( rawStack, geom, step, mask )
{
   const result = anrStackStructureMask( rawStack, geom.width, geom.height, step, mask, ANR_STACK_PROTECT_SIGMAS, ANR_STACK_FOOTPRINT_SIGMAS );
   const total = mask.reduce( ( a, v ) => a + v, 0 );
   anrInfo( format( "Stack protection: %d of %d RTN pixels (%.2f%%) left unrepaired because the unregistered stack of the raw frames " +
                    "shows a star on them (own excess > %.0f sigma: %d, footprint of the adjacent pixels > %.0f sigma: %d)",
                    result.count, total, ( total > 0 ) ? 100 * result.count / total : 0,
                    ANR_STACK_PROTECT_SIGMAS, result.ownCount, ANR_STACK_FOOTPRINT_SIGMAS, result.footprintCount ) );
   if ( result.count > ANR_STACK_KEEP_WARNING * total )
      console.warningln( format( "** Warning: %.1f%% of the RTN pixels look bright in the stack of the lights. The darks may not match the lights " +
                                 "(temperature, gain, exposure); those pixels are left as WBPP alone would leave them.", 100 * result.count / total ) );
   return result.keep;
}

// ---------------------------------------------------------------------------
// Cool file
// ---------------------------------------------------------------------------

function anrBuildCoolFiles( p, geom, step, stack, outDir )
{
   anrHeader( "Cool file (unregistered average stack)" );
   if ( p.lightFiles.length < ANR_RECOMMENDED_COOL_FRAMES )
      console.warningln( format( "** Warning: only %d frames; %d or more are recommended for a clean cool file.",
                                 p.lightFiles.length, ANR_RECOMMENDED_COOL_FRAMES ) );
   const pixels = geom.width * geom.height;
   if ( step === 1 && geom.channels === 1 )
   {
      const imbalance = anrCfaPhaseImbalance( stack[ 0 ], geom.width, geom.height );
      if ( imbalance > ANR_CFA_IMBALANCE_WARNING )
         console.warningln( format( "** Warning: the 2x2 pixel phases differ by a factor of %.2f. " +
                                    "If this is undebayered color (CFA) data, select 'Bayer CFA' and run again.", imbalance ) );
   }
   const results = stack.map( plane =>
      anrComputeCoolFile( plane, geom.width, geom.height, step, p.coolSigma, p.coolProtectStructures ) );
   results.forEach( ( r, c ) =>
      anrInfo( format( "Channel %d: %d cool pixels corrected (%.4f%%), %d skipped on structures, residual sigma per CFA phase = ",
                       c, r.correctedCount, 100 * r.correctedCount / pixels, r.protectedCount ) +
               r.sigmas.map( s => s.toExponential( 3 ) ).join( ", " ) ) );

   const history = [ anrHistory( format( "%d frames, threshold %.2f sigma, CFA step %d, structure protection %s",
                                         p.lightFiles.length, p.coolSigma, step, p.coolProtectStructures ? "on" : "off" ) ) ];
   const stackPath = anrOutputPath( outDir, "unregistered_stack", p.overwrite );
   anrWriteImage( stackPath, stack, geom.width, geom.height, {}, history.concat( [ anrHistory( "unregistered average stack" ) ] ) );
   const coolPath = anrOutputPath( outDir, "coolfile", p.overwrite );
   const coolFiles = results.map( r => r.coolFile );
   anrWriteImage( coolPath, coolFiles, geom.width, geom.height, {}, history.concat( [ anrHistory( "cool file" ) ] ) );
   anrInfo( "Unregistered stack written: " + stackPath );
   anrInfo( "Cool file written: " + coolPath );
   return coolFiles;
}

// ---------------------------------------------------------------------------
// Stage A
// ---------------------------------------------------------------------------

function anrCorrectedHistory( p, mask, step )
{
   const lines = [];
   if ( mask )
      lines.push( anrHistory( format( "RTN pixel mapping, ratio %.2f, CFA step %d, structure protection %s",
                                      p.rtnRatio, step,
                                      p.rtnProtectStructures ? format( "on (%.0f sigma per frame; in the stack %.0f sigma own excess or %.0f sigma footprint)",
                                                                       ANR_RTN_PROTECT_SIGMAS, ANR_STACK_PROTECT_SIGMAS, ANR_STACK_FOOTPRINT_SIGMAS ) : "off" ) ) );
   if ( p.coolEnabled )
      lines.push( anrHistory( format( "cool file correction, threshold %.2f sigma, CFA step %d, structure protection %s",
                                      p.coolSigma, step, p.coolProtectStructures ? "on" : "off" ) ) );
   return lines;
}

function anrWriteCorrectedLights( p, geom, step, mask, keep, coolFiles, outDir )
{
   anrHeader( "Writing corrected light frames" );
   const history = anrCorrectedHistory( p, mask, step );
   const outPaths = anrPlanOutputPaths( p.lightFiles, outDir, p.outputSuffix, ANR_OUTPUT_EXT, p.overwrite,
                                        path => File.exists( path ) );
   return p.lightFiles.map( ( path, i ) =>
   {
      anrCheckAbort();
      const frame = anrReadFrame( path );
      const prepared = anrPreparePlanes( frame, geom, step, mask, p.rtnProtectStructures, keep );
      const planes = coolFiles ? prepared.planes.map( ( plane, c ) => anrAddCoolFile( plane, coolFiles[ c ] ) )
                               : prepared.planes;
      const outPath = outPaths[ i ];
      anrWriteImage( outPath, planes, geom.width, geom.height, anrSourceMeta( frame ), history );
      anrInfo( format( "%d/%d: ", i + 1, p.lightFiles.length ) + outPath +
               ( mask ? format( " (RTN repaired: %d, kept on stars/outliers: %d, of which by the stack: %d)",
                                prepared.repaired, prepared.kept, prepared.stackKept ) : "" ) );
      return outPath;
   } );
}

/**
 * Runs Stage A and returns the list of corrected frame paths.
 */
function anrRunStageA( p )
{
   if ( p.lightFiles.length === 0 )
      throw new Error( "No light frames have been specified." );
   if ( !p.rtnEnabled && !p.coolEnabled )
      throw new Error( "Enable RTN pixel mapping and/or cool file correction." );
   if ( p.coolEnabled && p.lightFiles.length < ANR_MIN_COOL_FRAMES )
      throw new Error( format( "The cool file needs at least %d light frames.", ANR_MIN_COOL_FRAMES ) );

   const startTime = Date.now();
   const outDir = anrResolveOutputDir( p.outputDir, p.lightFiles );
   const first = anrReadFrame( p.lightFiles[ 0 ] );
   const geom = anrGeometryOf( first );
   const step = anrResolveStep( p.cfaMode, first );
   anrHeader( format( "Stage A: %d frames, %dx%dx%d, neighborhood step %d (%s)",
                      p.lightFiles.length, geom.width, geom.height, geom.channels, step,
                      ( step === 2 ) ? "Bayer CFA" : "mono/RGB" ) );
   anrInfo( "Output directory: " + outDir );

   const mask = p.rtnEnabled ? anrBuildDefectMask( p, geom, outDir ) : null;
   const protectByStack = mask !== null && p.rtnProtectStructures;
   const stacks = ( p.coolEnabled || protectByStack ) ? anrStackLights( p, geom, step, mask, protectByStack, p.coolEnabled ) : null;
   const keep = protectByStack ? anrStackProtection( stacks.raw[ 0 ], geom, step, mask ) : null;
   const coolFiles = p.coolEnabled ? anrBuildCoolFiles( p, geom, step, stacks.repaired, outDir ) : null;
   const outputs = anrWriteCorrectedLights( p, geom, step, mask, keep, coolFiles, outDir );

   anrHeader( format( "Stage A completed: %d frames in %.1f s", outputs.length, ( Date.now() - startTime ) / 1000 ) );
   return outputs;
}

// ---------------------------------------------------------------------------
// Stage B (Cosmicut)
// ---------------------------------------------------------------------------

function anrMasterKeywords( keywords, count )
{
   return keywords.filter( k => k.name.trim().toUpperCase() !== "NCOMBINE" )
                  .concat( [ new FITSKeyword( "NCOMBINE", count.toString(), "Number of combined frames" ) ] );
}

/**
 * Runs the Cosmicut composite on registered frames and returns the master path.
 */
function anrRunStageB( p )
{
   const files = p.registeredFiles;
   if ( files.length < ANR_MIN_COSMICUT_FRAMES )
      throw new Error( format( "Cosmicut needs at least %d registered frames.", ANR_MIN_COSMICUT_FRAMES ) );

   const startTime = Date.now();
   const outDir = anrResolveOutputDir( p.cosmicutOutputDir, files );
   anrHeader( format( "Stage B: Cosmicut composite of %d registered frames", files.length ) );

   let geom = null;
   let meta = null;
   let accumulators = null;
   files.forEach( ( path, i ) =>
   {
      anrCheckAbort();
      anrInfo( format( "Adding %d/%d: ", i + 1, files.length ) + path );
      const frame = anrReadFrame( path );
      if ( geom === null )
      {
         geom = anrGeometryOf( frame );
         meta = anrSourceMeta( frame );
         accumulators = frame.planes.map( () => new AnrCosmicutAccumulator( geom.width * geom.height, p.cosmicutExcludeZero ) );
      }
      anrCheckGeometry( frame, geom );
      frame.planes.forEach( ( plane, c ) => accumulators[ c ].add( plane ) );
   } );

   const history = [ anrHistory( format( "Cosmicut composite (sum - max)/(n - 1) of %d frames%s",
                                         files.length, p.cosmicutExcludeZero ? ", zero = no data" : "" ) ) ];
   const masterPath = anrOutputPath( outDir, p.cosmicutMasterName, p.overwrite );
   const masterMeta = { keywords: anrMasterKeywords( meta.keywords, files.length ),
                        properties: meta.properties, description: meta.description };
   anrWriteImage( masterPath, accumulators.map( a => a.result() ), geom.width, geom.height, masterMeta, history );
   anrInfo( "Master written: " + masterPath );

   if ( p.cosmicutSaveMax )
   {
      const maxPath = anrOutputPath( outDir, p.cosmicutMaxName, p.overwrite );
      anrWriteImage( maxPath, accumulators.map( a => a.maxImage() ), geom.width, geom.height, {},
                     [ anrHistory( "per-pixel maximum (rejected samples)" ) ] );
      anrInfo( "Rejected-maximum map written: " + maxPath );
   }

   anrHeader( format( "Stage B completed in %.1f s", ( Date.now() - startTime ) / 1000 ) );
   return masterPath;
}

// ==== ApranatNR-WBPP.js ====
// ----------------------------------------------------------------------------
// ApranatNR-WBPP.js - runs ApranatNR inside WBPP as a pipeline builder.
//
// WBPP (3.2+) lets a "pipeline builder" script assemble the light pipeline.
// This module builds the standard WBPP light pipeline and inserts:
//   - one "ApranatNR" step per light group, right after its calibration
//     (before cosmetic correction / debayering): RTN pixel mapping + cool file
//   - optionally, after the integration, one "ApranatNR Cosmicut" step per
//     integration group, writing an extra master next to the WBPP master.
// WBPP itself is not modified. The pure helpers at the top are unit tested in
// Node; the functions below them need the WBPP runtime and are only called
// from anrWbppBuilderMain().
// ----------------------------------------------------------------------------

// Must match ANR_CFA_*, ANR_MIN_DARK_FRAMES and ANR_MIN_COOL_FRAMES in
// ApranatNR-Engine.js (checked at run time by anrWbppCheckConstants()).
const ANR_WBPP_CFA_MODES = Object.freeze( { auto: 0, mono: 1, bayer: 2 } );
const ANR_WBPP_MIN_RTN_DARKS = 8;
const ANR_WBPP_MIN_COOL_FRAMES = 2;
const ANR_WBPP_MIN_COSMICUT_FRAMES = 3;

const ANR_WBPP_SUBDIR = "apranatnr";
const ANR_WBPP_SUFFIX = "_anr";
const ANR_WBPP_SETTINGS_FILE = "ApranatNR-WBPP-Settings.json";
const ANR_WBPP_STEP_NAME = "ApranatNR";
const ANR_WBPP_COSMICUT_STEP_NAME = "ApranatNR Cosmicut";

const ANR_WBPP_DEFAULT_SETTINGS = Object.freeze( {
   rtnEnabled: true,
   rtnDefectMapPath: "",
   rtnUseWbppDarks: true,
   rtnRatio: 4.0,
   rtnProtectStructures: true,
   coolEnabled: true,
   coolSigma: 5.0,
   coolProtectStructures: true,
   cfaMode: "auto",
   cosmicutEnabled: false,
   cosmicutExcludeZero: true
} );

const ANR_WBPP_SETTINGS_SCHEMA = Object.freeze( {
   rtnEnabled: { type: "boolean" },
   rtnDefectMapPath: { type: "string" },
   rtnUseWbppDarks: { type: "boolean" },
   rtnRatio: { type: "number", min: 1.5, max: 20 },
   rtnProtectStructures: { type: "boolean" },
   coolEnabled: { type: "boolean" },
   coolSigma: { type: "number", min: 0, max: 10 },
   coolProtectStructures: { type: "boolean" },
   cfaMode: { type: "string", values: Object.keys( ANR_WBPP_CFA_MODES ) },
   cosmicutEnabled: { type: "boolean" },
   cosmicutExcludeZero: { type: "boolean" }
} );

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function anrWbppCheckValue( key, value, rule )
{
   if ( typeof value !== rule.type )
      return "\"" + key + "\" must be a " + rule.type;
   if ( rule.type === "number" && !( Number.isFinite( value ) && value >= rule.min && value <= rule.max ) )
      return "\"" + key + "\" must be between " + rule.min + " and " + rule.max;
   if ( rule.values && rule.values.indexOf( value ) < 0 )
      return "\"" + key + "\" must be one of " + rule.values.map( v => "\"" + v + "\"" ).join( ", " );
   return null;
}

/**
 * Parses the settings file: JSON, where whole lines starting with // are
 * comments. Unknown keys, wrong types and out-of-range values are errors;
 * missing keys take their default value.
 * @returns {object} a new settings object
 */
function anrWbppParseSettings( text )
{
   const json = String( text ).replace( /^﻿/, "" )   // byte order mark (e.g. Windows Notepad)
                              .split( /\r?\n/ ).filter( line => !/^\s*\/\//.test( line ) ).join( "\n" );
   let raw;
   try
   {
      raw = JSON.parse( json );
   }
   catch ( x )
   {
      throw new Error( "ApranatNR WBPP settings: invalid JSON (" + x.message + ")" );
   }
   if ( raw === null || typeof raw !== "object" || Array.isArray( raw ) )
      throw new Error( "ApranatNR WBPP settings: the file must contain a JSON object" );

   const problems = Object.keys( raw ).map( key =>
      ANR_WBPP_SETTINGS_SCHEMA.hasOwnProperty( key )
         ? anrWbppCheckValue( key, raw[ key ], ANR_WBPP_SETTINGS_SCHEMA[ key ] )
         : "unknown key \"" + key + "\"" ).filter( p => p !== null );
   if ( problems.length > 0 )
      throw new Error( "ApranatNR WBPP settings: " + problems.join( "; " ) );
   return Object.assign( {}, ANR_WBPP_DEFAULT_SETTINGS, raw );
}

/**
 * Returns a new entry list with one addition per group: right after the entry
 * that calibrates that group (searched from `start`, the first light-pipeline
 * entry), or at `start` for groups that are not calibrated in this run.
 * @param {Array} entries queue entries (not modified)
 * @param {number} start
 * @param {(entry: any) => any} calibratedGroupOf the group an entry calibrates, or null
 * @param {Array<{group: any, entry: any}>} additions
 */
function anrWbppInsertAfterCalibration( entries, start, calibratedGroupOf, additions )
{
   const byGroup = new Map( additions.map( a => [ a.group, a.entry ] ) );
   const calibrated = new Set();
   for ( let i = start; i < entries.length; ++i )
   {
      const g = calibratedGroupOf( entries[ i ] );
      if ( g != null && byGroup.has( g ) )
         calibrated.add( g );
   }
   const result = entries.slice( 0, start ).concat(
      additions.filter( a => !calibrated.has( a.group ) ).map( a => a.entry ) );
   for ( let i = start; i < entries.length; ++i )
   {
      result.push( entries[ i ] );
      const g = calibratedGroupOf( entries[ i ] );
      if ( g != null && calibrated.has( g ) )
      {
         result.push( byGroup.get( g ) );
         calibrated.delete( g );
      }
   }
   return result;
}

/**
 * Where the RTN defect map comes from: an explicit map file, the individual
 * dark frames WBPP matched to the light group, or nowhere (with the reason).
 */
function anrWbppRtnSource( settings, darkFiles )
{
   if ( !settings.rtnEnabled )
      return { kind: "none", reason: "RTN pixel mapping is disabled in the settings" };
   if ( settings.rtnDefectMapPath.length > 0 )
      return { kind: "map", path: settings.rtnDefectMapPath };
   if ( !settings.rtnUseWbppDarks )
      return { kind: "none", reason: "no defect map is set and the use of the WBPP darks is disabled" };
   if ( darkFiles.length === 0 )
      return { kind: "none", reason: "no individual dark frames are matched to this group (a master dark cannot be used)" };
   if ( darkFiles.length < ANR_WBPP_MIN_RTN_DARKS )
      return { kind: "none", reason: "only " + darkFiles.length + " individual dark frames are matched to this group (" +
                                      ANR_WBPP_MIN_RTN_DARKS + " needed)" };
   return { kind: "darks", files: darkFiles.slice() };
}

/**
 * Field values for AnrParameters (stage A) of one light group.
 */
function anrWbppStageAFields( settings, lightFiles, rtnSource, outputDir, isCFA )
{
   const cfaMode = ( settings.cfaMode === "auto" )
      ? ( isCFA ? ANR_WBPP_CFA_MODES.bayer : ANR_WBPP_CFA_MODES.mono )
      : ANR_WBPP_CFA_MODES[ settings.cfaMode ];
   return {
      lightFiles: lightFiles.slice(),
      cfaMode: cfaMode,
      rtnEnabled: rtnSource.kind !== "none",
      rtnDefectMapPath: ( rtnSource.kind === "map" ) ? rtnSource.path : "",
      darkFiles: ( rtnSource.kind === "darks" ) ? rtnSource.files.slice() : [],
      rtnRatio: settings.rtnRatio,
      rtnProtectStructures: settings.rtnProtectStructures,
      coolEnabled: settings.coolEnabled && lightFiles.length >= ANR_WBPP_MIN_COOL_FRAMES,
      coolSigma: settings.coolSigma,
      coolProtectStructures: settings.coolProtectStructures,
      outputDir: outputDir,
      outputSuffix: ANR_WBPP_SUFFIX,
      overwrite: true
   };
}

function anrWbppHasWork( fields )
{
   return fields.rtnEnabled || fields.coolEnabled;
}

// ---------------------------------------------------------------------------
// WBPP runtime glue (needs the WBPP globals: engine, BPPOperationBlock, BPP,
// ImageType, OperationBlockStatus)
// ---------------------------------------------------------------------------

function anrWbppCheckConstants()
{
   if ( ANR_WBPP_CFA_MODES.auto !== ANR_CFA_AUTO || ANR_WBPP_CFA_MODES.mono !== ANR_CFA_MONO ||
        ANR_WBPP_CFA_MODES.bayer !== ANR_CFA_BAYER || ANR_WBPP_MIN_RTN_DARKS !== ANR_MIN_DARK_FRAMES ||
        ANR_WBPP_MIN_COOL_FRAMES !== ANR_MIN_COOL_FRAMES || ANR_WBPP_MIN_COSMICUT_FRAMES !== ANR_MIN_COSMICUT_FRAMES )
      throw new Error( "ApranatNR: internal constant mismatch between ApranatNR-WBPP.js and ApranatNR-Engine.js" );
}

function anrWbppSettingsPath( builderPath )
{
   return File.extractDrive( builderPath ) + File.extractDirectory( builderPath ) + "/" + ANR_WBPP_SETTINGS_FILE;
}

/**
 * Individual dark frames of the dark group WBPP matched to a light group,
 * without the frames WBPP has excluded. Once WBPP has integrated the master
 * dark it adds the master to the same group (hasMaster becomes true), so
 * master files are skipped, not the whole group.
 */
function anrWbppDarkFilesFor( engine, group )
{
   const cg = engine.calibrationMatcher.getCalibrationGroupsFor( group );
   const darkGroup = cg ? cg.masterDark : undefined;
   if ( !darkGroup )
      return [];
   return darkGroup.activeFrames().map( f => f.fileItem ).filter( item => !item.isMaster )
                   .map( item => item.filePath ).filter( p => typeof p === "string" && p.length > 0 );
}

function anrWbppRegisteredPath( frame )
{
   const processed = frame.fileItem && frame.fileItem.processed ? frame.fileItem.processed[ frame.associatedID ] : undefined;
   const filePath = processed ? processed[ BPP.FrameProcessingStep.REGISTRATION ] : undefined;
   return ( typeof filePath === "string" && filePath.length > 0 && File.exists( filePath ) ) ? filePath : null;
}

function anrWbppWarn( engine, op, text )
{
   console.warningln( "<end><cbr>** Warning: " + text );
   engine.processLogger.addWarning( text );
   op.hasWarnings = true;
}

function anrWbppOperation( name, group, run )
{
   const op = new BPPOperationBlock( name, group, true /*trackable*/ );
   op.envForScript = () => ( { name: name, status: op.status, statusMessage: op.statusMessage, group: group } );
   op._run = ( env, requestInterruption ) => run( op, requestInterruption );
   return op;
}

function anrWbppRunStageA( engine, group, settings, op )
{
   const frames = group.activeFrames();
   if ( frames.length === 0 )
   {
      op.statusMessage = "no active frames";
      return OperationBlockStatus.DONE;
   }
   const source = anrWbppRtnSource( settings, anrWbppDarkFilesFor( engine, group ) );
   if ( source.kind === "none" && settings.rtnEnabled )
      anrWbppWarn( engine, op, "ApranatNR: RTN pixel mapping skipped: " + source.reason + "." );
   const outputDir = engine.outputDirectory + "/" + ANR_WBPP_SUBDIR + "/" + group.folderName();
   const fields = anrWbppStageAFields( settings, frames.map( f => f.current ), source, outputDir, group.isCFA );
   if ( settings.coolEnabled && !fields.coolEnabled )
      anrWbppWarn( engine, op, format( "ApranatNR: cool file skipped: %d frame(s) in this group (%d needed).",
                                       frames.length, ANR_WBPP_MIN_COOL_FRAMES ) );
   if ( !anrWbppHasWork( fields ) )
   {
      op.statusMessage = "nothing to do";
      return OperationBlockStatus.DONE;
   }

   const outputs = anrRunStageA( Object.assign( new AnrParameters, fields ) );
   if ( outputs.length !== frames.length )
      throw new Error( format( "ApranatNR wrote %d frames for %d inputs", outputs.length, frames.length ) );
   frames.forEach( ( frame, i ) => frame.processingSucceeded( BPP.FrameProcessingStep.CALIBRATION, outputs[ i ] ) );

   const what = [ fields.rtnEnabled ? ( source.kind === "map" ? "RTN map" : "RTN from " + source.files.length + " darks" ) : "",
                  fields.coolEnabled ? "cool file" : "" ].filter( s => s.length > 0 ).join( " + " );
   op.statusMessage = format( "%d frames (%s)", outputs.length, what );
   engine.processLogger.addSuccess( ANR_WBPP_STEP_NAME, op.statusMessage + " -> " + outputDir );
   return OperationBlockStatus.DONE;
}

function anrWbppRunCosmicut( engine, group, settings, op )
{
   const files = group.activeFrames().filter( f => !f.__fastIntegration ).map( anrWbppRegisteredPath ).filter( p => p !== null );
   if ( files.length < ANR_WBPP_MIN_COSMICUT_FRAMES )
   {
      anrWbppWarn( engine, op, format( "ApranatNR Cosmicut skipped: %d registered frames (%d needed).", files.length, ANR_WBPP_MIN_COSMICUT_FRAMES ) );
      op.statusMessage = "skipped";
      return OperationBlockStatus.CANCELED;
   }
   const p = Object.assign( new AnrParameters, {
      registeredFiles: files,
      cosmicutExcludeZero: settings.cosmicutExcludeZero,
      cosmicutOutputDir: engine.outputDirectory + "/master",
      cosmicutMasterName: "master" + group.folderName() + "_cosmicut",
      overwrite: true
   } );
   const masterPath = anrRunStageB( p );
   op.statusMessage = format( "%d frames", files.length );
   engine.processLogger.addSuccess( ANR_WBPP_COSMICUT_STEP_NAME, masterPath );
   return OperationBlockStatus.DONE;
}

function anrWbppErrorOperation( engine, message )
{
   return anrWbppOperation( ANR_WBPP_STEP_NAME, undefined, ( op, requestInterruption ) =>
   {
      console.criticalln( "<end><cbr>*** Error: " + message );
      engine.processLogger.addError( message );
      op.statusMessage = message;
      requestInterruption();
      return OperationBlockStatus.FAILED;
   } );
}

function anrWbppReplaceQueue( queue, entries )
{
   queue.operations.splice( 0, queue.operations.length, ...entries );
   queue.operations.forEach( ( e, i ) => { e.operation.__index__ = i; } );
}

function anrWbppEntry( operation )
{
   return { operation: operation, params: undefined };
}

function anrWbppStageAEntry( engine, group, settings )
{
   const op = anrWbppOperation( ANR_WBPP_STEP_NAME, group, ( self ) => anrWbppRunStageA( engine, group, settings, self ) );
   op.failsFramesOnError = true;
   op.spaceRequired = () => group.groupSize();
   // the corrected frames are one more copy of the calibrated lights
   if ( engine.WS && engine.WS.calibrationLight )
      engine.WS.calibrationLight.size += op.spaceRequired();
   return anrWbppEntry( op );
}

function anrWbppCosmicutEntries( engine, settings )
{
   if ( !settings.cosmicutEnabled )
      return [];
   if ( !engine.imageRegistration )
   {
      // no console output here: the builder runs on every GUI interaction
      const message = "ApranatNR Cosmicut needs image registration, which is disabled: no Cosmicut master will be written.";
      engine.pipelineBuilderWarning = message;
      return [ anrWbppEntry( anrWbppOperation( ANR_WBPP_COSMICUT_STEP_NAME, undefined, ( op ) =>
      {
         anrWbppWarn( engine, op, message );
         op.statusMessage = "skipped";
         return OperationBlockStatus.CANCELED;
      } ) ) ];
   }
   return engine.groupsManager.groupsForMode( BPP.GroupingMode.POST )
      .filter( g => g.isActive && g.imageType == ImageType.Light )
      .map( g => anrWbppEntry( anrWbppOperation( ANR_WBPP_COSMICUT_STEP_NAME, g,
                                                 ( self ) => anrWbppRunCosmicut( engine, g, settings, self ) ) ) );
}

function anrWbppAddSteps( engine, settings, start )
{
   const queue = engine.operationQueue;
   const additions = engine.groupsManager.groupsForMode( BPP.GroupingMode.PRE )
      .filter( g => g.imageType == ImageType.Light )
      .map( g => ( { group: g, entry: anrWbppStageAEntry( engine, g, settings ) } ) );
   const calibratedGroupOf = e =>
      ( e.operation instanceof engine.calibrationOperation && e.operation.group && e.operation.group.imageType == ImageType.Light )
         ? e.operation.group : null;
   const entries = anrWbppInsertAfterCalibration( queue.operations, start, calibratedGroupOf, additions )
      .concat( anrWbppCosmicutEntries( engine, settings ) );
   anrWbppReplaceQueue( queue, entries );
}

/**
 * Builds the standard WBPP light pipeline plus the ApranatNR steps. A settings
 * problem does not silently fall back to plain WBPP: it is shown in the
 * pipeline panel and queued as a failing step that stops the run before the
 * lights are processed.
 */
function anrWbppBuild( engine, settingsText, settingsPath )
{
   const queue = engine.operationQueue;
   const start = queue.operations.length;
   try
   {
      engine.pipelineManager.buildPipelineForLight();
   }
   catch ( x )
   {
      // leave the queue as it was, so that WBPP's own fallback starts clean
      queue.operations.splice( start );
      throw x;
   }

   try
   {
      anrWbppCheckConstants();
      if ( settingsText === null )
         throw new Error( "ApranatNR WBPP settings file not found: " + settingsPath );
      anrWbppAddSteps( engine, anrWbppParseSettings( settingsText ), start );
   }
   catch ( x )
   {
      const message = ( x instanceof Error ) ? x.message : String( x );
      engine.pipelineBuilderWarning = message;
      anrWbppReplaceQueue( queue, queue.operations.slice( 0, start )
         .concat( [ anrWbppEntry( anrWbppErrorOperation( engine, message ) ) ], queue.operations.slice( start ) ) );
   }
}

function anrWbppBuilderMain( engine )
{
   const settingsPath = anrWbppSettingsPath( engine.pipelineBuilderScriptFile );
   const settingsText = File.exists( settingsPath ) ? File.readTextFile( settingsPath ) : null;
   anrWbppBuild( engine, settingsText, settingsPath );
}

if ( typeof module !== "undefined" && module.exports )
   module.exports = {
      ANR_WBPP_CFA_MODES,
      ANR_WBPP_DEFAULT_SETTINGS,
      anrWbppParseSettings,
      anrWbppInsertAfterCalibration,
      anrWbppRtnSource,
      anrWbppStageAFields,
      anrWbppHasWork
   };

// ==== entry point: WBPP evaluates this file with `engine` in scope ====
anrWbppBuilderMain( engine );
