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
