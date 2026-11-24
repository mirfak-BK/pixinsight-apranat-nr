// ----------------------------------------------------------------------------
// FlatSmooth-Core.js - pure numeric code (no PixInsight objects), shared by
// the script and the node tests.
//
// A master flat built from too few or too dim flat frames carries per-pixel
// noise. Dividing every light by it stamps the same pattern on all frames at
// the same sensor position; drift between frames then smears it into
// "walking noise" (diagonal streaks). Smoothing the flat within each CFA
// colour removes that noise and keeps the vignetting and dust shading.
// ----------------------------------------------------------------------------

const FS_SMOOTH_PASSES = 3;        // 3 box passes approximate a Gaussian
const FS_CLIP_SIGMAS = 4.0;
const FS_NOISE_RADIUS = 2;         // 5x5 local mean for the noise estimate
const FS_SAMPLE_STRIDE = 3;        // robust statistics on every 3rd row and column
const FS_MAX_RADIUS = 32;
const FS_MAD_TO_SIGMA = 1.4826;

/** Median of a numeric array (finite values only); NaN when empty. */
function fsMedian( values )
{
   const v = Float64Array.from( Array.prototype.filter.call( values, Number.isFinite ) ).sort();
   if ( v.length === 0 )
      return NaN;
   const h = v.length >> 1;
   return ( v.length & 1 ) ? v[ h ] : 0.5 * ( v[ h - 1 ] + v[ h ] );
}

/** Robust standard deviation: 1.4826 x median absolute deviation. */
function fsMadSigma( values )
{
   const m = fsMedian( values );
   return FS_MAD_TO_SIGMA * fsMedian( Array.prototype.map.call( values, x => Math.abs( x - m ) ) );
}

/** Values of `plane` (w x h) on every `stride`-th row and column. */
function fsSubsample( plane, w, h, stride )
{
   const out = [];
   for ( let y = 0; y < h; y += stride )
      for ( let x = 0; x < w; x += stride )
         out.push( plane[ y * w + x ] );
   return out;
}

/** One-dimensional running mean over 2r+1 samples, edges replicated. */
function fsBoxLine( src, srcOffset, stride, n, r, dst, dstOffset )
{
   const at = i => src[ srcOffset + Math.min( n - 1, Math.max( 0, i ) ) * stride ];
   let sum = 0;
   for ( let i = -r; i <= r; ++i )
      sum += at( i );
   const norm = 1 / ( 2 * r + 1 );
   for ( let i = 0; i < n; ++i )
   {
      dst[ dstOffset + i * stride ] = sum * norm;
      sum += at( i + r + 1 ) - at( i - r );
   }
}

/** Mean over a (2r+1)^2 box with replicated edges; returns a new Float64Array. */
function fsBoxMean( plane, w, h, r )
{
   const tmp = new Float64Array( w * h );
   const out = new Float64Array( w * h );
   for ( let y = 0; y < h; ++y )
      fsBoxLine( plane, y * w, 1, w, r, tmp, y * w );
   for ( let x = 0; x < w; ++x )
      fsBoxLine( tmp, x, w, h, r, out, x );
   return out;
}

/**
 * Sample at (x, y), linearly extrapolated one pixel beyond the edges so that
 * a shading gradient does not bias edge pixels (needs w, h >= 2).
 */
function fsSampleExtrapolated( plane, w, h, x, y )
{
   if ( x < 0 ) return 2 * fsSampleExtrapolated( plane, w, h, 0, y ) - fsSampleExtrapolated( plane, w, h, 1, y );
   if ( x >= w ) return 2 * fsSampleExtrapolated( plane, w, h, w - 1, y ) - fsSampleExtrapolated( plane, w, h, w - 2, y );
   if ( y < 0 ) return 2 * plane[ x ] - plane[ w + x ];
   if ( y >= h ) return 2 * plane[ ( h - 1 ) * w + x ] - plane[ ( h - 2 ) * w + x ];
   return plane[ y * w + x ];
}

/**
 * Median of the 8 neighbours of each pixel, without the pixel itself:
 * robust to isolated outliers, and the residual against it has no spike at
 * zero (which would shrink a MAD-based sigma).
 */
function fsNeighbourMedian( plane, w, h )
{
   const out = new Float64Array( w * h );
   const v = new Float64Array( 8 );
   for ( let y = 0; y < h; ++y )
      for ( let x = 0; x < w; ++x )
      {
         const inside = x > 0 && y > 0 && x < w - 1 && y < h - 1;
         let k = 0;
         for ( let j = -1; j <= 1; ++j )
            for ( let i = -1; i <= 1; ++i )
               if ( i !== 0 || j !== 0 )
                  v[ k++ ] = inside ? plane[ ( y + j ) * w + x + i ] : fsSampleExtrapolated( plane, w, h, x + i, y + j );
         v.sort();
         out[ y * w + x ] = 0.5 * ( v[ 3 ] + v[ 4 ] );
      }
   return out;
}

/** Pixels of one CFA phase (or the whole plane when step = 1) as a new array. */
function fsExtractPhase( plane, w, h, step, dx, dy )
{
   const pw = Math.ceil( ( w - dx ) / step ), ph = Math.ceil( ( h - dy ) / step );
   const data = new Float64Array( pw * ph );
   for ( let y = 0; y < ph; ++y )
      for ( let x = 0; x < pw; ++x )
         data[ y * pw + x ] = plane[ ( dy + y * step ) * w + dx + x * step ];
   return { data: data, width: pw, height: ph };
}

/**
 * Relative per-pixel noise of a flat phase: robust std of (pixel - local
 * mean) / local mean, corrected for the pixel's own weight in the mean.
 */
function fsRelativeNoise( data, w, h )
{
   const mean = fsBoxMean( data, w, h, FS_NOISE_RADIUS );
   const rel = new Float64Array( data.length );
   for ( let i = 0; i < data.length; ++i )
      rel[ i ] = ( mean[ i ] > 0 && Number.isFinite( data[ i ] ) ) ? ( data[ i ] - mean[ i ] ) / mean[ i ] : NaN;
   const n = ( 2 * FS_NOISE_RADIUS + 1 ) * ( 2 * FS_NOISE_RADIUS + 1 );
   return fsMadSigma( fsSubsample( rel, w, h, FS_SAMPLE_STRIDE ) ) / Math.sqrt( 1 - 1 / n );
}

/** 1-D weights of `passes` box filters of radius r convolved together. */
function fsKernel1D( r, passes )
{
   const box = new Array( 2 * r + 1 ).fill( 1 / ( 2 * r + 1 ) );
   let k = [ 1 ];
   for ( let p = 0; p < passes; ++p )
   {
      const next = new Array( k.length + box.length - 1 ).fill( 0 );
      k.forEach( ( a, i ) => box.forEach( ( b, j ) => { next[ i + j ] += a * b; } ) );
      k = next;
   }
   return k;
}

/** Factor by which the 2-D smoothing reduces white pixel noise: sqrt(sum w^2). */
function fsNoiseFactor( r, passes )
{
   if ( r <= 0 )
      return 1;
   return fsKernel1D( r, passes ).reduce( ( s, w ) => s + w * w, 0 );   // (sum w1^2) = sqrt of the 2-D sum
}

/**
 * Smallest radius whose smoothing brings `noise` down to `target`; 0 when the
 * flat is already quiet enough, FS_MAX_RADIUS at most.
 */
function fsChooseRadius( noise, target, passes )
{
   if ( !( noise > target ) )
      return 0;
   for ( let r = 1; r <= FS_MAX_RADIUS; ++r )
      if ( noise * fsNoiseFactor( r, passes ) <= target )
         return r;
   return FS_MAX_RADIUS;
}

/**
 * Smooths one phase: pixels deviating more than FS_CLIP_SIGMAS from the
 * median of their 8 neighbours (hot/dead pixels, non-finite or non-positive values) are
 * replaced by it (a median, so one hot pixel cannot drag its neighbours), then `passes` box means of radius r are applied.
 * @returns {{data: Float64Array, clipped: number}}
 */
function fsSmoothPhase( data, w, h, r, passes )
{
   const finite = Float64Array.from( data, v => ( Number.isFinite( v ) && v > 0 ) ? v : NaN );
   const fill = fsMedian( fsSubsample( finite, w, h, FS_SAMPLE_STRIDE ) );
   const base = finite.map( v => Number.isNaN( v ) ? fill : v );
   const local = fsNeighbourMedian( base, w, h );
   const residual = base.map( ( v, i ) => v - local[ i ] );
   const sigma = fsMadSigma( fsSubsample( residual, w, h, FS_SAMPLE_STRIDE ) );
   let clipped = 0;
   let out = base.map( ( v, i ) =>
   {
      if ( Number.isNaN( finite[ i ] ) || Math.abs( residual[ i ] ) > FS_CLIP_SIGMAS * sigma )
      {
         ++clipped;
         return local[ i ];
      }
      return v;
   } );
   for ( let p = 0; p < passes; ++p )
      out = fsBoxMean( out, w, h, r );
   return { data: out, clipped: clipped };
}

/** CFA phase offsets [dx, dy] for step 2, or the whole plane for step 1. */
function fsPhases( step )
{
   return ( step === 2 ) ? [ [ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ 1, 1 ] ] : [ [ 0, 0 ] ];
}

/**
 * Measures each phase of a plane.
 * @returns {Array<{dx: number, dy: number, mean: number, noise: number}>}
 */
function fsAnalyzePlane( plane, w, h, step )
{
   return fsPhases( step ).map( ( [ dx, dy ] ) =>
   {
      const ph = fsExtractPhase( plane, w, h, step, dx, dy );
      return { dx: dx, dy: dy, mean: fsMedian( fsSubsample( ph.data, ph.width, ph.height, FS_SAMPLE_STRIDE ) ),
               noise: fsRelativeNoise( ph.data, ph.width, ph.height ) };
   } );
}

/**
 * Smooths every phase of a plane with radius r (in phase pixels).
 * @returns {{plane: Float32Array, clipped: number}}  a new plane
 */
function fsSmoothPlane( plane, w, h, step, r, passes )
{
   const out = new Float32Array( w * h );
   let clipped = 0;
   for ( const [ dx, dy ] of fsPhases( step ) )
   {
      const ph = fsExtractPhase( plane, w, h, step, dx, dy );
      const s = fsSmoothPhase( ph.data, ph.width, ph.height, r, passes );
      clipped += s.clipped;
      for ( let y = 0; y < ph.height; ++y )
         for ( let x = 0; x < ph.width; ++x )
            out[ ( dy + y * step ) * w + dx + x * step ] = s.data[ y * ph.width + x ];
   }
   return { plane: out, clipped: clipped };
}

if ( typeof module !== "undefined" && module.exports )
   module.exports = {
      FS_SMOOTH_PASSES, FS_MAX_RADIUS,
      fsMedian, fsMadSigma, fsNeighbourMedian, fsSubsample, fsBoxMean, fsExtractPhase, fsRelativeNoise, fsKernel1D, fsNoiseFactor,
      fsChooseRadius, fsSmoothPhase, fsPhases, fsAnalyzePlane, fsSmoothPlane
   };
