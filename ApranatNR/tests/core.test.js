"use strict";

const test = require( "node:test" );
const assert = require( "node:assert/strict" );
const core = require( "../ApranatNR-Core.js" );

function seededRandom( seed )
{
   let s = seed >>> 0;
   return function()
   {
      s = ( s + 0x6D2B79F5 ) >>> 0;
      let t = s;
      t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
      t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
      return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
   };
}

function gaussianGenerator( seed )
{
   const rand = seededRandom( seed );
   return function()
   {
      const u = Math.max( rand(), 1e-12 );
      const v = rand();
      return Math.sqrt( -2 * Math.log( u ) ) * Math.cos( 2 * Math.PI * v );
   };
}

function filledFrame( width, height, value )
{
   return new Float32Array( width * height ).fill( value );
}

function bayerFrame( width, height, r, g, b )
{
   const data = new Float32Array( width * height );
   for ( let y = 0; y < height; ++y )
      for ( let x = 0; x < width; ++x )
      {
         const isEvenRow = ( y % 2 ) === 0;
         const isEvenCol = ( x % 2 ) === 0;
         data[ y * width + x ] = isEvenRow ? ( isEvenCol ? r : g ) : ( isEvenCol ? g : b );
      }
   return data;
}

// ---------------------------------------------------------------------------

test( "medianInPlace returns the middle value for odd counts", () =>
{
   const buf = new Float64Array( [ 5, 1, 9, 3, 7 ] );
   assert.equal( core.anrMedianInPlace( buf, 5 ), 5 );
} );

test( "medianInPlace averages the two middle values for even counts", () =>
{
   const buf = new Float64Array( [ 4, 1, 3, 2, 99, 99 ] );
   assert.equal( core.anrMedianInPlace( buf, 4 ), 2.5 );
} );

test( "robustLocationScale returns median and MAD-based sigma", () =>
{
   const values = new Float32Array( [ 1, 2, 3, 4, 5, 6, 7, 8, 9 ] );
   const { median, sigma } = core.anrRobustLocationScale( values, 1000 );
   assert.equal( median, 5 );
   assert.ok( Math.abs( sigma - 2 * core.ANR_MAD_TO_SIGMA ) < 1e-9 );
} );

test( "robustLocationScale ignores non-finite values", () =>
{
   const values = new Float32Array( [ NaN, 1, 2, 3, NaN ] );
   assert.equal( core.anrRobustLocationScale( values, 1000 ).median, 2 );
} );

test( "neighborMedian uses the 8 adjacent pixels for mono data", () =>
{
   const w = 3, h = 3;
   const data = new Float32Array( [ 1, 2, 3, 4, 100, 6, 7, 8, 9 ] );
   const buf = new Float64Array( 8 );
   assert.equal( core.anrNeighborMedian( data, w, h, 1, 1, 1, null, buf ), 5 );
} );

test( "neighborMedian with step 2 only uses same-color CFA pixels", () =>
{
   const w = 5, h = 5;
   const data = bayerFrame( w, h, 0.2, 0.1, 0.05 );
   const buf = new Float64Array( 8 );
   assert.ok( Math.abs( core.anrNeighborMedian( data, w, h, 2, 2, 2, null, buf ) - 0.2 ) < 1e-7 );
} );

test( "neighborMedian returns NaN when too few neighbors are available", () =>
{
   const w = 3, h = 2; // (0,0) with step 2 only reaches (2,0)
   const data = filledFrame( w, h, 0.5 );
   const buf = new Float64Array( 8 );
   assert.ok( Number.isNaN( core.anrNeighborMedian( data, w, h, 0, 0, 2, null, buf ) ) );
} );

test( "neighborMedian skips neighbors flagged in the mask", () =>
{
   const w = 3, h = 3;
   const data = new Float32Array( [ 1, 1, 1, 1, 0, 1, 1, 1, 50 ] );
   const mask = new Uint8Array( 9 );
   mask[ 8 ] = 1;
   const buf = new Float64Array( 8 );
   assert.equal( core.anrNeighborMedian( data, w, h, 1, 1, 1, mask, buf ), 1 );
} );

test( "computeCoolFile detects a dark pixel and stores the lift needed", () =>
{
   const w = 16, h = 16;
   const gauss = gaussianGenerator( 1 );
   const stack = new Float32Array( w * h );
   for ( let i = 0; i < stack.length; ++i )
      stack[ i ] = 0.1 + 0.0005 * gauss();
   const coolIndex = 8 * w + 8;
   stack[ coolIndex ] = 0.05;

   const result = core.anrComputeCoolFile( stack, w, h, 1, 3 );

   assert.ok( Math.abs( result.coolFile[ coolIndex ] - 0.05 ) < 0.003 );
   assert.equal( result.correctedCount, 1 );
} );

test( "computeCoolFile never produces negative corrections", () =>
{
   const w = 16, h = 16;
   const gauss = gaussianGenerator( 2 );
   const stack = new Float32Array( w * h );
   for ( let i = 0; i < stack.length; ++i )
      stack[ i ] = 0.1 + 0.001 * gauss();

   const result = core.anrComputeCoolFile( stack, w, h, 1, 0 );

   assert.ok( result.coolFile.every( v => v >= 0 ) );
   assert.ok( result.correctedCount > 0, "threshold 0 should lift every below-median pixel" );
} );

test( "computeCoolFile with CFA step has no false positives on a Bayer pattern", () =>
{
   const w = 16, h = 16;
   const stack = bayerFrame( w, h, 0.2, 0.1, 0.05 );
   const coolIndex = 8 * w + 8; // even row, even col => R pixel
   stack[ coolIndex ] = 0.12;

   const result = core.anrComputeCoolFile( stack, w, h, 2, 3 );

   assert.equal( result.correctedCount, 1 );
   assert.ok( Math.abs( result.coolFile[ coolIndex ] - 0.08 ) < 1e-6 );
} );

// Star with shot noise: noise grows with the signal, so a background-based
// sigma sees many "dark" fluctuations inside the star (the failure seen on real data).
function starField( w, h, seed )
{
   const gauss = gaussianGenerator( seed );
   const stack = new Float32Array( w * h );
   const cx = w / 2, cy = h / 2, s = 2.0;
   for ( let y = 0; y < h; ++y )
      for ( let x = 0; x < w; ++x )
      {
         const d2 = ( x - cx ) * ( x - cx ) + ( y - cy ) * ( y - cy );
         const star = 0.5 * Math.exp( -d2 / ( 2 * s * s ) );
         stack[ y * w + x ] = 0.1 + star + Math.sqrt( 0.0005 * 0.0005 + 0.0001 * star ) * gauss();
      }
   return stack;
}

function countWithinRadius( coolFile, w, h, radius )
{
   let n = 0;
   for ( let y = 0; y < h; ++y )
      for ( let x = 0; x < w; ++x )
         if ( coolFile[ y * w + x ] > 0 && Math.hypot( x - w / 2, y - h / 2 ) <= radius )
            ++n;
   return n;
}

test( "computeCoolFile does not flag star wings when structures are protected", () =>
{
   const w = 32, h = 32;
   const result = core.anrComputeCoolFile( starField( w, h, 3 ), w, h, 1, 3, true );
   assert.equal( countWithinRadius( result.coolFile, w, h, 6 ), 0 );
   assert.ok( result.protectedCount > 0, "rejected structure pixels should be reported" );
} );

test( "computeCoolFile flags star wings when protection is disabled (original behavior)", () =>
{
   const w = 32, h = 32;
   const result = core.anrComputeCoolFile( starField( w, h, 3 ), w, h, 1, 3, false );
   assert.ok( countWithinRadius( result.coolFile, w, h, 6 ) > 0 );
   assert.equal( result.protectedCount, 0 );
} );

test( "computeCoolFile still finds a cool pixel next to a bright star", () =>
{
   const w = 32, h = 32;
   const stack = starField( w, h, 4 );
   const coolIndex = 4 * w + 4; // far enough from the star to sit on flat sky
   stack[ coolIndex ] = 0.05;
   const result = core.anrComputeCoolFile( stack, w, h, 1, 3, true );
   assert.ok( Math.abs( result.coolFile[ coolIndex ] - 0.05 ) < 0.003 );
} );

test( "computeCoolFile with protection still finds two adjacent cool pixels", () =>
{
   const w = 16, h = 16;
   const gauss = gaussianGenerator( 5 );
   const stack = new Float32Array( w * h );
   for ( let i = 0; i < stack.length; ++i )
      stack[ i ] = 0.1 + 0.0005 * gauss();
   stack[ 8 * w + 8 ] = 0.05;
   stack[ 8 * w + 9 ] = 0.06;
   const result = core.anrComputeCoolFile( stack, w, h, 1, 3, true );
   assert.ok( result.coolFile[ 8 * w + 8 ] > 0.04 );
   assert.ok( result.coolFile[ 8 * w + 9 ] > 0.03 );
} );

test( "computeCoolFile does not modify its input", () =>
{
   const w = 8, h = 8;
   const stack = filledFrame( w, h, 0.1 );
   stack[ 3 * w + 3 ] = 0.01;
   const copy = Float32Array.from( stack );
   core.anrComputeCoolFile( stack, w, h, 1, 3 );
   assert.deepEqual( stack, copy );
} );

test( "addCoolFile returns a new clamped frame", () =>
{
   const frame = new Float32Array( [ 0.2, 0.99, 0.5 ] );
   const cool = new Float32Array( [ 0.1, 0.05, 0 ] );
   const out = core.anrAddCoolFile( frame, cool );
   assert.ok( Math.abs( out[ 0 ] - 0.3 ) < 1e-6 );
   assert.equal( out[ 1 ], 1 );
   assert.ok( Math.abs( out[ 2 ] - 0.5 ) < 1e-7 );
   assert.ok( Math.abs( frame[ 0 ] - 0.2 ) < 1e-7, "input must be untouched" );
} );

test( "addCoolFile leaves untouched pixels exactly as they were", () =>
{
   const frame = new Float32Array( [ -0.01, 1.2, 0.3 ] );
   const cool = new Float32Array( [ 0, 0, 0.1 ] );
   const out = core.anrAddCoolFile( frame, cool );
   assert.equal( out[ 0 ], frame[ 0 ], "negative background must not be clipped" );
   assert.equal( out[ 1 ], frame[ 1 ], "values above 1 must not be clipped" );
   assert.ok( Math.abs( out[ 2 ] - 0.4 ) < 1e-6 );
} );

test( "addCoolFile rejects arrays of different length", () =>
{
   assert.throws( () => core.anrAddCoolFile( new Float32Array( 3 ), new Float32Array( 4 ) ) );
} );

test( "MeanAccumulator averages frames", () =>
{
   const acc = new core.AnrMeanAccumulator( 2 );
   acc.add( new Float32Array( [ 0.1, 0.4 ] ) );
   acc.add( new Float32Array( [ 0.3, 0.2 ] ) );
   const mean = acc.mean();
   assert.equal( acc.count, 2 );
   assert.ok( Math.abs( mean[ 0 ] - 0.2 ) < 1e-7 );
   assert.ok( Math.abs( mean[ 1 ] - 0.3 ) < 1e-7 );
} );

test( "MeanAccumulator rejects frames of the wrong size", () =>
{
   const acc = new core.AnrMeanAccumulator( 2 );
   assert.throws( () => acc.add( new Float32Array( 3 ) ) );
} );

test( "TemporalStats computes per-pixel sample standard deviation", () =>
{
   const stats = new core.AnrTemporalStats( 2 );
   [ 0, 1, 0, 1 ].forEach( v => stats.add( new Float32Array( [ v, 0.5 ] ) ) );
   const std = stats.std();
   assert.ok( Math.abs( std[ 0 ] - Math.sqrt( 1 / 3 ) ) < 1e-6 );
   assert.ok( Math.abs( std[ 1 ] ) < 1e-6 );
} );

test( "TemporalStats needs at least two frames", () =>
{
   const stats = new core.AnrTemporalStats( 1 );
   stats.add( new Float32Array( [ 0.1 ] ) );
   assert.throws( () => stats.std() );
} );

test( "TemporalStats trimmed std ignores a one-off spike", () =>
{
   const stats = new core.AnrTemporalStats( 1 );
   [ 0.1, 0.1, 0.1, 0.1, 0.9 ].forEach( v => stats.add( new Float32Array( [ v ] ) ) );
   assert.ok( stats.std()[ 0 ] > 0.3, "plain std is inflated by the spike" );
   assert.ok( stats.trimmedStd()[ 0 ] < 1e-6 );
   assert.ok( Math.abs( stats.trimmedMean()[ 0 ] - 0.1 ) < 1e-6 );
} );

test( "TemporalStats trimmed std keeps a two-level oscillation", () =>
{
   const stats = new core.AnrTemporalStats( 1 );
   [ 0, 0.02, 0, 0.02, 0, 0.02, 0, 0.02 ].forEach( v => stats.add( new Float32Array( [ v ] ) ) );
   assert.ok( stats.trimmedStd()[ 0 ] > 0.009 );
} );

test( "TemporalStats trimmed statistics need at least four frames", () =>
{
   const stats = new core.AnrTemporalStats( 1 );
   [ 0.1, 0.2, 0.3 ].forEach( v => stats.add( new Float32Array( [ v ] ) ) );
   assert.throws( () => stats.trimmedStd() );
   assert.throws( () => stats.trimmedMean() );
} );

function warmPixelScene()
{
   // 90% normal pixels, 10% warm pixels whose larger noise matches their
   // higher dark level, plus one RTN pixel: normal level, abnormal noise.
   const n = 10000;
   const level = new Float32Array( n );
   const std = new Float32Array( n );
   const rand = seededRandom( 11 );
   for ( let i = 0; i < n; ++i )
   {
      const isWarm = i % 10 === 0;
      level[ i ] = ( isWarm ? 0.05 : 0.01 ) + 0.0001 * rand();
      std[ i ] = ( isWarm ? 0.004 : 0.001 ) * ( 0.9 + 0.2 * rand() );
   }
   const rtnIndex = 5;
   std[ rtnIndex ] = 0.005;
   return { level, std, rtnIndex };
}

test( "detectNoisyPixels with dark levels flags RTN pixels but not warm pixels", () =>
{
   const { level, std, rtnIndex } = warmPixelScene();
   const result = core.anrDetectNoisyPixels( std, 3, level );
   assert.equal( result.mask[ rtnIndex ], 1 );
   assert.equal( result.count, 1 );
} );

test( "detectNoisyPixels without dark levels also flags warm pixels (global criterion)", () =>
{
   const { std } = warmPixelScene();
   assert.ok( core.anrDetectNoisyPixels( std, 3 ).count >= 1000 );
} );

test( "detectNoisyPixels with identical dark levels matches the global criterion", () =>
{
   const std = new Float32Array( 100 ).fill( 0.01 );
   std[ 10 ] = 0.05;
   const level = new Float32Array( 100 ).fill( 0.02 );
   const result = core.anrDetectNoisyPixels( std, 3, level );
   assert.equal( result.count, 1 );
   assert.equal( result.mask[ 10 ], 1 );
} );

test( "detectNoisyPixels flags pixels above ratio x median std", () =>
{
   const std = new Float32Array( 100 ).fill( 0.01 );
   std[ 10 ] = 0.05;
   std[ 20 ] = 0.031;
   std[ 30 ] = 0.029;
   const result = core.anrDetectNoisyPixels( std, 3 );
   assert.equal( result.count, 2 );
   assert.equal( result.mask[ 10 ], 1 );
   assert.equal( result.mask[ 20 ], 1 );
   assert.equal( result.mask[ 30 ], 0 );
   assert.ok( Math.abs( result.medianStd - 0.01 ) < 1e-7 );
} );

test( "noiseModel fits the read noise and the shot-noise slope of warm pixels", () =>
{
   // normalized units: normal level 0.04, read noise 1e-4, warm pixels with shot noise
   const n = 20000, warm = 2000;
   const level = new Float32Array( n + warm ).fill( 0.04 );
   const std = new Float32Array( n + warm ).fill( 1e-4 );
   for ( let k = 0; k < warm; ++k )
   {
      const e = 0.005 + 0.3 * k / warm;
      level[ n + k ] = 0.04 + e;
      std[ n + k ] = Math.sqrt( 1e-8 + 6e-5 * e );
   }
   const m = core.anrNoiseModel( std, level, 1e6 );
   assert.ok( Math.abs( m.base - 0.04 ) < 1e-7 );
   assert.ok( Math.abs( m.read - 1e-4 ) < 1e-9 );
   assert.ok( Math.abs( m.slope / 6e-5 - 1 ) < 0.01, "slope " + m.slope );
   assert.equal( m.warmPixels, warm );
   assert.ok( Math.abs( core.anrModelTypical( m, 0.03 ) - m.read ) < 1e-12, "read noise below the base level" );
   assert.ok( Math.abs( core.anrModelTypical( m, m.base + 0.1 ) - Math.sqrt( m.read * m.read + m.slope * 0.1 ) ) < 1e-12 );
} );

test( "detectNoisyPixels does not flag tiny fluctuations when most darks show none (clipped or quantized data)", () =>
{
   const std = new Float32Array( 1001 );
   const level = new Float32Array( 1001 ).fill( 0.04 );
   for ( let i = 600; i < 1000; ++i )
      std[ i ] = 1e-6;
   std[ 1000 ] = 1e-3;
   const result = core.anrDetectNoisyPixels( std, 4, level );
   assert.equal( result.model.read, 0 );
   assert.equal( result.count, 1 );
   assert.equal( result.mask[ 1000 ], 1 );
} );

test( "lowerQuartileLevel estimates the lower quartile from the trimmed mean and std", () =>
{
   const low = core.anrLowerQuartileLevel( Float32Array.of( 0.04, 0.05 ), Float32Array.of( 0, 0.001 ) );
   assert.ok( low instanceof Float32Array );
   assert.ok( Math.abs( low[ 0 ] - 0.04 ) < 1e-9 );
   assert.ok( Math.abs( low[ 1 ] - ( 0.05 - 0.0006745 ) ) < 1e-8 );
} );

test( "detectNoisyPixels at the lower-quartile level flags a pixel whose upward jumps raise its mean", () =>
{
   // normal pixels and shot-noise warm pixels (read 1e-4, slope 6e-5), plus one pixel that
   // jumps by 1.5e-3 every other frame: mean +7.5e-4, std 7.5e-4
   const n = 20000, warm = 400;
   const mean = new Float32Array( n + warm + 1 ).fill( 0.04 );
   const std = new Float32Array( n + warm + 1 ).fill( 1e-4 );
   for ( let k = 0; k < warm; ++k )
   {
      const e = 0.002 + 0.1 * k / warm;
      mean[ n + k ] = 0.04 + e;
      std[ n + k ] = Math.sqrt( 1e-8 + 6e-5 * e );
   }
   const j = n + warm;
   mean[ j ] = 0.04 + 7.5e-4;
   std[ j ] = 7.5e-4;
   assert.equal( core.anrDetectNoisyPixels( std, 4, mean ).mask[ j ], 0, "by its mean it looks like a warm pixel" );
   const result = core.anrDetectNoisyPixels( std, 4, core.anrLowerQuartileLevel( mean, std ) );
   assert.equal( result.mask[ j ], 1 );
   assert.equal( result.count, 1, "warm pixels stay unflagged" );
} );

test( "noiseModel stays flat when there are too few warm pixels", () =>
{
   const level = new Float32Array( 1000 ).fill( 0.04 );
   const std = new Float32Array( 1000 ).fill( 1e-4 );
   for ( let k = 0; k < 10; ++k )
   {
      level[ k ] = 0.2;
      std[ k ] = 0.003;
   }
   const m = core.anrNoiseModel( std, level, 1e6 );
   assert.equal( m.slope, 0 );
   assert.equal( m.warmPixels, 10 );
} );

/** normal pixels, noisy pixels slightly above the normal level, warm and hot pixels with shot noise */
function levelSpreadScene()
{
   const rand = seededRandom( 5 );
   const level = [], std = [];
   const push = ( l, s ) => { level.push( l ); std.push( s ); };
   for ( let i = 0; i < 20000; ++i )
      push( 0.04 + 2e-5 * ( rand() - 0.5 ), 1e-4 * ( 0.9 + 0.2 * rand() ) );
   const noisy = [ level.length ];
   for ( let i = 0; i < 400; ++i )      // 8x noise, levels scattered 1-3 read noises above normal: a level group of its own
      push( 0.04 + 1e-4 + 2e-4 * rand(), 8e-4 * ( 0.9 + 0.2 * rand() ) );
   noisy.push( level.length );
   const hot = [ level.length ];
   for ( let i = 0; i < 460; ++i )      // excess from 0.003 up to 0.9 (log-uniform), fluctuation = shot noise
   {
      const e = 0.003 * Math.pow( 300, rand() );
      push( 0.04 + e, Math.sqrt( 1e-8 + 6e-5 * e ) * ( 0.95 + 0.1 * rand() ) );
   }
   hot.push( level.length );
   return { level: Float32Array.from( level ), std: Float32Array.from( std ), noisy, hot };
}

test( "detectNoisyPixels flags noisy pixels off the normal level instead of letting them raise their own threshold", () =>
{
   const scene = levelSpreadScene();
   const result = core.anrDetectNoisyPixels( scene.std, 4, scene.level );
   let flagged = 0;
   for ( let i = scene.noisy[ 0 ]; i < scene.noisy[ 1 ]; ++i )
      flagged += result.mask[ i ];
   assert.equal( flagged, scene.noisy[ 1 ] - scene.noisy[ 0 ] );
} );

test( "detectNoisyPixels does not flag warm or hot pixels whose fluctuation is their shot noise, however bright", () =>
{
   const scene = levelSpreadScene();
   const result = core.anrDetectNoisyPixels( scene.std, 4, scene.level );
   let flagged = 0;
   for ( let i = scene.hot[ 0 ]; i < scene.hot[ 1 ]; ++i )
      flagged += result.mask[ i ];
   assert.equal( flagged, 0 );
   assert.ok( result.model.slope > 0, "the model is returned for the log" );
} );

test( "repairDefects replaces flagged pixels with clean neighbor median", () =>
{
   const w = 3, h = 3;
   const frame = new Float32Array( [ 1, 1, 1, 1, 80, 1, 1, 1, 90 ] );
   const mask = new Uint8Array( 9 );
   mask[ 4 ] = 1;
   mask[ 8 ] = 1;

   const result = core.anrRepairDefects( frame, w, h, mask, 1 );

   assert.equal( result.data[ 4 ], 1 );
   assert.equal( frame[ 4 ], 80, "input must be untouched" );
   assert.ok( result.repaired >= 1 );
   assert.equal( result.protectedCount, 0, "noise-free data gives no noise scale, so nothing is protected" );
} );

function noisyFlat( w, h, level, sigma, seed )
{
   const gauss = gaussianGenerator( seed );
   return Float32Array.from( { length: w * h }, () => level + sigma * gauss() );
}

test( "residualSigmas estimates the same-color residual noise per CFA phase", () =>
{
   const w = 80, h = 80;
   const gaussR = gaussianGenerator( 21 ), gaussO = gaussianGenerator( 22 );
   const frame = new Float32Array( w * h );
   for ( let y = 0; y < h; ++y )
      for ( let x = 0; x < w; ++x )
         frame[ y * w + x ] = ( y % 2 === 0 && x % 2 === 0 ) ? 0.2 + 0.01 * gaussR() : 0.1 + 0.02 * gaussO();

   const sigmas = core.anrResidualSigmas( frame, w, h, 2, null, 1e6 );

   assert.equal( sigmas.length, 4 );
   // residual = pixel - median of 8 neighbors, so slightly above the pixel noise
   assert.ok( sigmas[ 0 ] > 0.010 && sigmas[ 0 ] < 0.0125, "R phase " + sigmas[ 0 ] );
   for ( const s of sigmas.slice( 1 ) )
      assert.ok( s > 0.020 && s < 0.025, "other phase " + s );
} );

test( "residualSigmas ignores flagged pixels", () =>
{
   const w = 60, h = 60;
   const frame = noisyFlat( w, h, 0.1, 0.01, 23 );
   const mask = new Uint8Array( w * h );
   for ( let i = 0; i < mask.length; i += 3 )
   {
      frame[ i ] = 0.9;
      mask[ i ] = 1;
   }
   const [ sigma ] = core.anrResidualSigmas( frame, w, h, 1, mask, 1e6 );
   assert.ok( sigma > 0.010 && sigma < 0.0125, "sigma " + sigma );
} );

test( "repairDefects keeps a defect under a star core when structures are protected", () =>
{
   const w = 64, h = 64;
   const frame = starField( w, h, 31 );
   const center = 32 * w + 32;
   const mask = new Uint8Array( w * h );
   mask[ center ] = 1;

   const result = core.anrRepairDefects( frame, w, h, mask, 2 );

   assert.equal( result.data[ center ], frame[ center ] );
   assert.equal( result.protectedCount, 1 );
   assert.equal( result.repaired, 0 );
} );

test( "repairDefects replaces a star core when protection is disabled (original behavior)", () =>
{
   const w = 64, h = 64;
   const frame = starField( w, h, 31 );
   const center = 32 * w + 32;
   const mask = new Uint8Array( w * h );
   mask[ center ] = 1;

   const result = core.anrRepairDefects( frame, w, h, mask, 2, false );

   assert.ok( result.data[ center ] < 0.7 * frame[ center ], "star core is dimmed by the neighbor median" );
   assert.equal( result.protectedCount, 0 );
   assert.equal( result.repaired, 1 );
} );

test( "repairDefects with protection still repairs RTN excursions on the sky background", () =>
{
   const w = 64, h = 64;
   const frame = noisyFlat( w, h, 0.1, 0.001, 32 );
   const mask = new Uint8Array( w * h );
   const sites = [ [ 10, 10, +0.003 ], [ 40, 12, -0.003 ], [ 20, 50, +0.0035 ] ];
   for ( const [ x, y, jump ] of sites )
   {
      frame[ y * w + x ] += jump;
      mask[ y * w + x ] = 1;
   }

   const result = core.anrRepairDefects( frame, w, h, mask, 2 );

   assert.equal( result.repaired, sites.length );
   assert.equal( result.protectedCount, 0 );
   for ( const [ x, y ] of sites )
      assert.ok( Math.abs( result.data[ y * w + x ] - 0.1 ) < 0.002 );
} );

test( "repairDefects with protection still repairs a non-finite defect pixel", () =>
{
   const w = 40, h = 40;
   const frame = noisyFlat( w, h, 0.1, 0.001, 34 );
   const mask = new Uint8Array( w * h );
   const nanAt = 20 * w + 20, infAt = 10 * w + 30;
   frame[ nanAt ] = NaN;
   frame[ infAt ] = Infinity;
   mask[ nanAt ] = mask[ infAt ] = 1;

   const result = core.anrRepairDefects( frame, w, h, mask, 2 );

   assert.ok( Math.abs( result.data[ nanAt ] - 0.1 ) < 0.005 );
   assert.ok( Math.abs( result.data[ infAt ] - 0.1 ) < 0.005 );
   assert.equal( result.repaired, 2 );
   assert.equal( result.protectedCount, 0 );
} );

test( "residualSigmas on a strided subsample stays close to the full estimate", () =>
{
   const w = 80, h = 80;
   const frame = noisyFlat( w, h, 0.1, 0.01, 35 );
   const full = core.anrResidualSigmas( frame, w, h, 2, null, 1e6 );
   const sampled = core.anrResidualSigmas( frame, w, h, 2, null, 500 );
   sampled.forEach( ( s, k ) => assert.ok( Math.abs( s / full[ k ] - 1 ) < 0.15, `phase ${k}: ${s} vs ${full[ k ]}` ) );
} );

test( "repairDefects applies each CFA phase's own noise limit", () =>
{
   const w = 80, h = 80;
   const gaussQ = gaussianGenerator( 36 ), gaussN = gaussianGenerator( 37 );
   const frame = new Float32Array( w * h );
   for ( let y = 0; y < h; ++y )
      for ( let x = 0; x < w; ++x )   // phase (row even, col odd) is quiet, all others noisy
         frame[ y * w + x ] = 0.1 + ( ( y % 2 === 0 && x % 2 === 1 ) ? 0.001 * gaussQ() : 0.004 * gaussN() );
   const quiet = 40 * w + 41, noisy = 41 * w + 40;   // phases (0,1) and (1,0) swap under a transposed index
   frame[ quiet ] += 0.008;    // ~7 sigma of its quiet phase
   frame[ noisy ] += 0.008;    // ~2 sigma of its noisy phase
   const mask = new Uint8Array( w * h );
   mask[ quiet ] = mask[ noisy ] = 1;

   const result = core.anrRepairDefects( frame, w, h, mask, 2 );

   assert.equal( result.data[ quiet ], frame[ quiet ], "quiet-phase excursion is beyond its limit" );
   assert.notEqual( result.data[ noisy ], frame[ noisy ], "noisy-phase excursion is within its limit" );
   assert.equal( result.protectedCount, 1 );
   assert.equal( result.repaired, 1 );
} );

test( "repairDefects with protection leaves a huge one-frame outlier to pixel rejection", () =>
{
   const w = 64, h = 64;
   const frame = noisyFlat( w, h, 0.1, 0.001, 33 );
   const i = 30 * w + 30;
   frame[ i ] = 0.9;
   const mask = new Uint8Array( w * h );
   mask[ i ] = 1;

   const result = core.anrRepairDefects( frame, w, h, mask, 2 );

   assert.equal( result.data[ i ], frame[ i ] );
   assert.equal( result.protectedCount, 1 );
} );

/** stack of an undithered sequence: flat sky with a faint star that stays on the same pixels */
function faintStarStack( w, h, seed )
{
   const stack = noisyFlat( w, h, 0.1, 0.0002, seed );
   const cx = 32, cy = 32;
   for ( let y = 0; y < h; ++y )
      for ( let x = 0; x < w; ++x )
         stack[ y * w + x ] += 0.004 * Math.exp( -( ( x - cx ) ** 2 + ( y - cy ) ** 2 ) / ( 2 * 1.2 * 1.2 ) );
   return { stack, center: cy * w + cx };
}

test( "stackStructureMask keeps map pixels under a faint persistent star, not RTN pixels on the sky", () =>
{
   const w = 64, h = 64;
   const { stack, center } = faintStarStack( w, h, 41 );
   const mask = new Uint8Array( w * h );
   mask[ center ] = 1;
   const sky = [ 10 * w + 10, 12 * w + 50, 50 * w + 20, 44 * w + 47 ];
   sky.forEach( ( i, k ) => { mask[ i ] = 1; stack[ i ] += ( k % 2 ? -1 : 1 ) * 0.0004; } );   // RTN means: within 2 sigma

   const result = core.anrStackStructureMask( stack, w, h, 2, mask, 5, 3 );

   assert.equal( result.keep[ center ], 1 );
   sky.forEach( i => assert.equal( result.keep[ i ], 0 ) );
   assert.equal( result.count, 1 );
   assert.equal( result.sigmas.length, 4 );
   assert.ok( result.sigmas.every( v => v > 0.00015 && v < 0.0004 ), "stack sigmas " + result.sigmas );
} );

test( "stackStructureMask keeps a map pixel beside a faint star core through the star's footprint", () =>
{
   const w = 64, h = 64;
   const stack = noisyFlat( w, h, 0.1, 0.0002, 44 );
   for ( let y = 0; y < h; ++y )
      for ( let x = 0; x < w; ++x )
         stack[ y * w + x ] += 0.0012 * Math.exp( -( ( x - 32 ) ** 2 + ( y - 32 ) ** 2 ) / ( 2 * 1.2 * 1.2 ) );
   const beside = 32 * w + 33;                 // one pixel off the core: little excess of its own
   const rtn = 12 * w + 12;                    // an excess confined to one pixel
   stack[ rtn ] += 0.0005;
   const mask = new Uint8Array( w * h );
   mask[ beside ] = mask[ rtn ] = 1;

   const result = core.anrStackStructureMask( stack, w, h, 2, mask, 5, 3 );

   assert.equal( result.keep[ beside ], 1, "kept through the footprint" );
   assert.equal( result.keep[ rtn ], 0, "a lone excess below 5 sigma is repaired" );
   assert.equal( result.footprintCount, 1 );
   assert.equal( result.ownCount, 0 );

   // a single bright unmapped neighbor (hot pixel) is not a star's footprint
   const lone = noisyFlat( w, h, 0.1, 0.0002, 45 );
   const site = 20 * w + 20;
   lone[ site + 1 ] += 0.01;
   const m2 = new Uint8Array( w * h );
   m2[ site ] = 1;
   assert.equal( core.anrStackStructureMask( lone, w, h, 2, m2, 5, 3 ).keep[ site ], 0 );
} );

test( "stackStructureMask does not keep a map pixel that is darker than its neighbors", () =>
{
   const w = 64, h = 64;
   const stack = noisyFlat( w, h, 0.1, 0.0002, 42 );
   const i = 30 * w + 30;
   stack[ i ] -= 0.01;
   const mask = new Uint8Array( w * h );
   mask[ i ] = 1;
   assert.equal( core.anrStackStructureMask( stack, w, h, 2, mask, 5, 3 ).keep[ i ], 0 );
   assert.throws( () => core.anrStackStructureMask( stack, w, h, 2, new Uint8Array( 5 ), 5, 3 ), /size/ );
} );

test( "repairDefects leaves the pixels kept by the stack and still repairs the others", () =>
{
   const w = 64, h = 64;
   // one frame: the faint star is buried in the frame noise, so the per-frame limit cannot see it
   const { stack } = faintStarStack( w, h, 43 );
   const frame = Float32Array.from( stack, ( v, k ) => v + 0.004 * Math.sin( 12.9898 * k ) );
   const center = 32 * w + 32, sky = 10 * w + 10;
   const mask = new Uint8Array( w * h );
   mask[ center ] = mask[ sky ] = 1;
   const keep = new Uint8Array( w * h );
   keep[ center ] = 1;

   const plain = core.anrRepairDefects( frame, w, h, mask, 2 );
   assert.notEqual( plain.data[ center ], frame[ center ], "without the stack the star core is repaired" );

   const result = core.anrRepairDefects( frame, w, h, mask, 2, true, keep );
   assert.equal( result.data[ center ], frame[ center ] );
   assert.equal( result.stackKept, 1 );
   assert.equal( result.repaired, 1 );
   assert.notEqual( result.data[ sky ], frame[ sky ] );

   const bad = Float32Array.from( frame );
   bad[ center ] = Infinity;
   const fixed = core.anrRepairDefects( bad, w, h, mask, 2, true, keep );
   assert.ok( Number.isFinite( fixed.data[ center ] ), "a non-finite value is replaced even where the stack keeps the pixel" );
   assert.equal( fixed.stackKept, 0 );
} );

test( "repairDefects leaves pixels without enough clean neighbors unchanged", () =>
{
   const w = 2, h = 2;
   const frame = new Float32Array( [ 5, 1, 1, 1 ] );
   const mask = new Uint8Array( [ 1, 0, 0, 0 ] );
   const result = core.anrRepairDefects( frame, w, h, mask, 2 );
   assert.equal( result.data[ 0 ], 5 );
   assert.equal( result.unrepaired, 1 );
} );

test( "Cosmicut drops the single highest value per pixel", () =>
{
   const acc = new core.AnrCosmicutAccumulator( 2, false );
   acc.add( new Float32Array( [ 0.10, 0.20 ] ) );
   acc.add( new Float32Array( [ 0.12, 0.22 ] ) );
   acc.add( new Float32Array( [ 0.95, 0.24 ] ) ); // cosmic ray on pixel 0
   const out = acc.result();
   assert.ok( Math.abs( out[ 0 ] - 0.11 ) < 1e-6 );
   assert.ok( Math.abs( out[ 1 ] - 0.21 ) < 1e-6 );
} );

test( "Cosmicut with zero exclusion counts valid samples per pixel", () =>
{
   const acc = new core.AnrCosmicutAccumulator( 3, true );
   acc.add( new Float32Array( [ 0.10, 0, 0 ] ) );
   acc.add( new Float32Array( [ 0.20, 0.30, 0 ] ) );
   acc.add( new Float32Array( [ 0.90, 0, 0 ] ) );
   const out = acc.result();
   assert.ok( Math.abs( out[ 0 ] - 0.15 ) < 1e-6, "two valid after max cut" );
   assert.ok( Math.abs( out[ 1 ] - 0.30 ) < 1e-6, "single valid sample is kept" );
   assert.equal( out[ 2 ], 0, "no valid samples gives zero" );
} );

test( "Cosmicut skips non-finite samples even without zero exclusion", () =>
{
   const acc = new core.AnrCosmicutAccumulator( 1, false );
   [ 0.1, NaN, 0.2, 0.9 ].forEach( v => acc.add( new Float32Array( [ v ] ) ) );
   assert.ok( Math.abs( acc.result()[ 0 ] - 0.15 ) < 1e-6 );
} );

test( "Cosmicut exposes the per-pixel maximum map", () =>
{
   const acc = new core.AnrCosmicutAccumulator( 1, false );
   acc.add( new Float32Array( [ 0.1 ] ) );
   acc.add( new Float32Array( [ 0.7 ] ) );
   assert.ok( Math.abs( acc.maxImage()[ 0 ] - 0.7 ) < 1e-6 );
} );

test( "Cosmicut needs at least two frames", () =>
{
   const acc = new core.AnrCosmicutAccumulator( 1, false );
   acc.add( new Float32Array( [ 0.1 ] ) );
   assert.throws( () => acc.result() );
} );

test( "planOutputPaths never targets a source file", () =>
{
   const sources = [ "/data/L_001.xisf", "/data/L_002.xisf" ];
   const paths = core.anrPlanOutputPaths( sources, "/data/", "", ".xisf", true, () => true );
   assert.deepEqual( paths, [ "/data/L_001_1.xisf", "/data/L_002_1.xisf" ] );
} );

test( "planOutputPaths keeps same-named sources from different folders apart", () =>
{
   const sources = [ "/night1/L_001.fits", "/night2/L_001.fits" ];
   const paths = core.anrPlanOutputPaths( sources, "/out", "_anr", ".xisf", true, () => false );
   assert.deepEqual( paths, [ "/out/L_001_anr.xisf", "/out/L_001_anr_1.xisf" ] );
} );

test( "planOutputPaths avoids existing files unless overwrite is set", () =>
{
   const exists = p => p === "/out/L_anr.xisf";
   assert.deepEqual( core.anrPlanOutputPaths( [ "/in/L.xisf" ], "/out", "_anr", ".xisf", false, exists ), [ "/out/L_anr_1.xisf" ] );
   assert.deepEqual( core.anrPlanOutputPaths( [ "/in/L.xisf" ], "/out", "_anr", ".xisf", true, exists ), [ "/out/L_anr.xisf" ] );
} );

test( "cfaPhaseImbalance is ~1 for mono data and large for an undetected Bayer pattern", () =>
{
   const w = 16, h = 16;
   assert.ok( core.anrCfaPhaseImbalance( filledFrame( w, h, 0.1 ), w, h ) < 1.01 );
   assert.ok( core.anrCfaPhaseImbalance( bayerFrame( w, h, 0.2, 0.1, 0.05 ), w, h ) > 3 );
} );

test( "end-to-end: cool file restores a non-linear cool pixel in noisy frames", () =>
{
   const w = 24, h = 24, n = 40;
   const gauss = gaussianGenerator( 7 );
   const coolIndex = 12 * w + 12;
   const frames = [];
   for ( let k = 0; k < n; ++k )
   {
      const f = new Float32Array( w * h );
      for ( let i = 0; i < f.length; ++i )
         f[ i ] = 0.1 + 0.01 * gauss(); // shot-noise dominated single frame
      f[ coolIndex ] = 0.6 * f[ coolIndex ];
      frames.push( f );
   }

   const acc = new core.AnrMeanAccumulator( w * h );
   frames.forEach( f => acc.add( f ) );
   const { coolFile } = core.anrComputeCoolFile( acc.mean(), w, h, 1, 3 );

   const corrected = new core.AnrMeanAccumulator( w * h );
   frames.forEach( f => corrected.add( core.anrAddCoolFile( f, coolFile ) ) );
   const result = corrected.mean();

   assert.ok( Math.abs( result[ coolIndex ] - 0.1 ) < 0.004,
      "cool pixel should be lifted to background, got " + result[ coolIndex ] );
} );
