"use strict";

const test = require( "node:test" );
const assert = require( "node:assert/strict" );
const core = require( "../DarkPixelPlot-Core.js" );

function rng( seed )
{
   let s = seed >>> 0;
   const uniform = () =>
   {
      s = ( s + 0x6D2B79F5 ) >>> 0;
      let t = s;
      t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
      t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
      return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
   };
   return { uniform, gauss: () => Math.sqrt( -2 * Math.log( Math.max( uniform(), 1e-12 ) ) ) * Math.cos( 2 * Math.PI * uniform() ) };
}

/** n frames of `length` pixels: level 2600 ADU, noise 80 ADU, plus special pixels */
function darkScene( n, length, seed )
{
   const r = rng( seed );
   const frames = Array.from( { length: n }, () => new Uint16Array( length ) );
   const rtn = [ 10, 20, 30 ], hot = [ 40, 41 ], spike = [ 50 ];
   for ( let k = 0; k < n; ++k )
      for ( let i = 0; i < length; ++i )
      {
         let v = 2600 + 80 * r.gauss();
         if ( rtn.includes( i ) ) v += ( k % 2 ) ? 1200 : 0;           // two-level
         if ( hot.includes( i ) ) v += 6000 + Math.sqrt( 4 * 6000 ) * r.gauss();   // high level, shot noise
         if ( spike.includes( i ) && k === 3 ) v = 65535;               // one saturated frame
         frames[ k ][ i ] = Math.max( 0, Math.min( 65535, Math.round( v ) ) );
      }
   return { frames, rtn, hot, spike };
}

test( "pixelStats computes the per-pixel median, std and trimmed std", () =>
{
   const frames = [ [ 10, 0 ], [ 20, 0 ], [ 30, 0 ], [ 40, 0 ], [ 1000, 0 ] ].map( a => Uint16Array.from( a ) );
   const s = core.dppPixelStats( frames );
   assert.equal( s.frames, 5 );
   assert.equal( s.median[ 0 ], 30 );
   const values = [ 10, 20, 30, 40, 1000 ], mean = values.reduce( ( a, b ) => a + b ) / 5;
   const std = Math.sqrt( values.reduce( ( a, v ) => a + ( v - mean ) ** 2, 0 ) / 4 );
   assert.ok( Math.abs( s.std[ 0 ] - std ) < 1e-3 );
   assert.ok( Math.abs( s.trimmedStd[ 0 ] - 10 ) < 1e-6, "trimmed std of 20, 30, 40" );
   assert.ok( Math.abs( s.trimmedMean[ 0 ] - 30 ) < 1e-6, "trimmed mean of 20, 30, 40" );
   assert.equal( s.std[ 1 ], 0 );
} );

test( "pixelStats averages the two middle values for an even frame count", () =>
{
   const frames = [ 1, 2, 3, 4, 5, 6 ].map( v => Uint16Array.from( [ v ] ) );
   assert.equal( core.dppPixelStats( frames ).median[ 0 ], 3.5 );
} );

test( "pixelStats needs at least four frames of equal size", () =>
{
   assert.throws( () => core.dppPixelStats( [ new Uint16Array( 2 ), new Uint16Array( 2 ), new Uint16Array( 2 ) ] ), /four/ );
   assert.throws( () => core.dppPixelStats( [ 1, 2, 3, 4 ].map( n => new Uint16Array( n ) ) ), /size/ );
} );

/** level/value arrays: `normal` pixels at `base` with fluctuation `read`, then warm pixels following shot noise */
function modelScene( normal, base, read, slope, excesses )
{
   const level = [], value = [];
   for ( let i = 0; i < normal; ++i )
   {
      level.push( base );
      value.push( read );
   }
   for ( const e of excesses )
   {
      level.push( base + e );
      value.push( Math.sqrt( read * read + slope * e ) );
   }
   return { level: Float32Array.from( level ), value: Float32Array.from( value ) };
}

const range = ( n, from, to ) => Array.from( { length: n }, ( _, i ) => from + ( to - from ) * i / Math.max( 1, n - 1 ) );

test( "noiseModel fits the read noise and the shot-noise slope of warm pixels", () =>
{
   const s = modelScene( 20000, 1000, 10, 3, range( 2000, 200, 20000 ) );
   const m = core.dppNoiseModel( s.level, s.value );
   assert.equal( m.base, 1000 );
   assert.equal( m.read, 10 );
   assert.ok( Math.abs( m.slope - 3 ) < 0.01, "slope " + m.slope );
   assert.equal( m.warmPixels, 2000 );
} );

test( "noiseModel typical is the read noise up to the base level and grows as a square root above it", () =>
{
   const m = { base: 1000, read: 10, slope: 3, warmPixels: 500 };
   assert.equal( core.dppModelTypical( m, 900 ), 10 );
   assert.equal( core.dppModelTypical( m, 1000 ), 10 );
   assert.ok( Math.abs( core.dppModelTypical( m, 2000 ) - Math.sqrt( 100 + 3000 ) ) < 1e-9 );
} );

test( "noiseModel uses only pixels well above the base level for the slope", () =>
{
   // noisy pixels scattered a little above the normal level must not raise the slope
   const s = modelScene( 20000, 1000, 10, 3, range( 2000, 200, 20000 ) );
   const level = Float32Array.from( [ ...s.level, ...range( 500, 1002, 1060 ).map( v => v ) ] );
   const value = Float32Array.from( [ ...s.value, ...new Array( 500 ).fill( 80 ) ] );
   const m = core.dppNoiseModel( level, value );
   assert.ok( Math.abs( m.slope - 3 ) < 0.01, "slope " + m.slope );
} );

test( "noiseModel ignores a minority of noisy warm pixels", () =>
{
   const s = modelScene( 20000, 1000, 10, 3, range( 2000, 200, 20000 ) );
   const extra = range( 300, 300, 10000 );
   const level = Float32Array.from( [ ...s.level, ...extra.map( e => 1000 + e ) ] );
   const value = Float32Array.from( [ ...s.value, ...extra.map( e => 5 * Math.sqrt( 100 + 3 * e ) ) ] );
   const m = core.dppNoiseModel( level, value );
   assert.ok( Math.abs( m.slope - 3 ) < 0.3, "slope " + m.slope );
} );

test( "noiseModel measures the slope on a bounded sample when there are many warm pixels", () =>
{
   const s = modelScene( 20000, 1000, 10, 3, range( 2000, 200, 20000 ) );
   const m = core.dppNoiseModel( s.level, s.value, 300 );
   assert.equal( m.warmPixels, 2000, "all warm pixels are counted" );
   assert.ok( Math.abs( m.slope - 3 ) < 0.01, "slope " + m.slope );
   assert.equal( core.dppModelTypical( { base: 1000, read: 10, slope: 0, warmPixels: 0 }, Infinity ), 10, "a flat model stays flat" );
} );

test( "noiseModel stays flat when there are too few warm pixels to measure the slope", () =>
{
   const m = core.dppNoiseModel( ...Object.values( modelScene( 20000, 1000, 10, 3, range( 10, 500, 5000 ) ) ) );
   assert.equal( m.slope, 0 );
   assert.equal( m.warmPixels, 10 );
   assert.throws( () => core.dppNoiseModel( Float32Array.of( NaN ), Float32Array.of( NaN ) ), /valid/ );
} );

test( "modelCurve samples the model along a linear or logarithmic axis", () =>
{
   const m = { base: 1000, read: 10, slope: 3, warmPixels: 500 };
   const log = core.dppModelCurve( m, core.dppAxis( 900, 90000, true, 100 ), 1, 50 );
   assert.equal( log.length, 51 );
   assert.ok( Math.abs( log[ 0 ][ 0 ] - 900 ) < 1e-6 && Math.abs( log[ 50 ][ 0 ] - 90000 ) < 1e-6 );
   assert.ok( Math.abs( log[ 25 ][ 0 ] - 9000 ) < 1e-6, "evenly spaced on the log axis" );
   assert.ok( Math.abs( log[ 50 ][ 1 ] - Math.sqrt( 100 + 3 * 89000 ) ) < 1e-6 );
   const lin = core.dppModelCurve( m, core.dppAxis( 900, 1100, false, 100 ), 4, 4 );
   assert.deepEqual( lin.map( p => p[ 0 ] ), [ 900, 950, 1000, 1050, 1100 ] );
   assert.equal( lin[ 0 ][ 1 ], 40, "scaled by the given factor" );
} );

test( "dashSegments splits a polyline into dashes of equal length", () =>
{
   const segs = core.dppDashSegments( [ [ 0, 0 ], [ 60, 0 ], [ 100, 0 ] ], 10, 5 );
   assert.deepEqual( segs.map( s => [ s[ 0 ], s[ 2 ] ] ), [ [ 0, 10 ], [ 15, 25 ], [ 30, 40 ], [ 45, 55 ], [ 60, 70 ], [ 75, 85 ], [ 90, 100 ] ] );
   assert.ok( segs.every( s => s[ 1 ] === 0 && s[ 3 ] === 0 ) );
   assert.deepEqual( core.dppDashSegments( [ [ 5, 5 ] ], 10, 5 ), [] );
   // diagonal, lengths not divisible by the pattern, dash continuing across a vertex
   // lengths 5 + 7 with dash 3, gap 1: 0-3 | 4-5 + 5-7 (split at the vertex) | 8-11
   const diag = core.dppDashSegments( [ [ 0, 0 ], [ 3, 4 ], [ 3, 11 ] ], 3, 1 );
   const len = diag.map( s => Math.hypot( s[ 2 ] - s[ 0 ], s[ 3 ] - s[ 1 ] ) );
   assert.deepEqual( len.map( l => Math.round( l * 1e9 ) / 1e9 ), [ 3, 1, 2, 3 ] );
   assert.equal( core.dppDashSegments( [ [ 0, 0 ], [ 10, 0 ] ], 3, 0 ).reduce( ( a, s ) => a + s[ 2 ] - s[ 0 ], 0 ), 10, "no gap: solid" );
} );

test( "classify flags two-level pixels, not hot pixels nor one-frame spikes", () =>
{
   const scene = darkScene( 24, 4000, 7 );
   const stats = core.dppPixelStats( scene.frames );
   const c = core.dppClassify( stats, 4, 20 );
   for ( const i of scene.rtn )
      assert.equal( c.noisy[ i ], 1, "RTN pixel " + i );
   for ( const i of scene.hot.concat( scene.spike ) )
      assert.equal( c.noisy[ i ], 0, "not RTN: " + i );
   assert.ok( c.counts.noisy <= scene.rtn.length + 2, "few false positives: " + c.counts.noisy );
   assert.equal( c.counts.hot, scene.hot.length );
   assert.ok( c.counts.spikes >= 1, "the saturated frame is counted as a spike" );
   assert.ok( Math.abs( c.typicalStd - 80 ) < 6, "typical std " + c.typicalStd );
   assert.ok( c.noisyStdRatio > 4 );
} );

test( "classify compares the trimmed std with the noise model at the lower-quartile level (ApranatNR criterion)", () =>
{
   // a two-level pixel keeps its normal low level, where the model gives the read noise
   const scene = darkScene( 24, 4000, 11 );
   const stats = core.dppPixelStats( scene.frames );
   const c = core.dppClassify( stats, 4, 20 );
   assert.ok( c.trimmedModel.base > 2530 && c.trimmedModel.base < 2580, "model base is the lower-quartile level of normal pixels" );
   assert.ok( c.trimmedModel.read > 60 && c.trimmedModel.read < 80, "trimmed read noise " + c.trimmedModel.read );
   assert.ok( c.stdModel.read > c.trimmedModel.read, "the plotted model uses the plain std" );
   for ( const i of scene.rtn )
      assert.equal( c.noisy[ i ], 1 );
} );

/** frames: normal pixels plus noisy pixels at a slightly raised level and warm/hot pixels with shot noise */
function levelScene( n, seed )
{
   const r = rng( seed );
   const normal = 20000, noisy = 400, warm = 400, hot = 60;
   const length = normal + noisy + warm + hot;
   const excess = new Float64Array( length ), sigma = new Float64Array( length ).fill( 20 );
   for ( let i = normal; i < normal + noisy; ++i )
   {
      excess[ i ] = 30 + 30 * r.uniform();     // off the normal level, inside the normal spread of hot medians
      sigma[ i ] = 160;                        // eight times the normal fluctuation
   }
   for ( let i = normal + noisy; i < length; ++i )
   {
      const top = ( i < normal + noisy + warm ) ? 2000 : 50000;
      excess[ i ] = 200 * Math.pow( top / 200, r.uniform() );
      sigma[ i ] = Math.sqrt( 400 + 4 * excess[ i ] );
   }
   const frames = Array.from( { length: n }, () => new Uint16Array( length ) );
   for ( let k = 0; k < n; ++k )
      for ( let i = 0; i < length; ++i )
         frames[ k ][ i ] = Math.round( 2600 + excess[ i ] + sigma[ i ] * r.gauss() );
   return { frames, noisy: [ normal, normal + noisy ], hot: [ normal + noisy, length ] };
}

test( "classify flags noisy pixels off the normal level instead of letting them raise their own threshold", () =>
{
   const scene = levelScene( 24, 21 );
   const c = core.dppClassify( core.dppPixelStats( scene.frames ), 4, 20 );
   let flagged = 0;
   for ( let i = scene.noisy[ 0 ]; i < scene.noisy[ 1 ]; ++i )
      flagged += c.noisy[ i ];
   assert.ok( flagged >= 0.95 * ( scene.noisy[ 1 ] - scene.noisy[ 0 ] ), "flagged " + flagged );
} );

test( "classify does not flag warm or hot pixels whose fluctuation is their shot noise, however bright", () =>
{
   const scene = levelScene( 24, 22 );
   const c = core.dppClassify( core.dppPixelStats( scene.frames ), 4, 20 );
   let flagged = 0;
   for ( let i = scene.hot[ 0 ]; i < scene.hot[ 1 ]; ++i )
      flagged += c.noisy[ i ];
   assert.ok( flagged <= 2, "flagged " + flagged );
   assert.ok( Math.abs( c.trimmedModel.slope / c.stdModel.slope - 0.75 ) < 0.15, "trimmed slope is a bit lower" );
   assert.ok( Math.abs( c.stdModel.slope - 4 ) < 0.5, "std slope " + c.stdModel.slope );
} );

test( "lowerLevel estimates the lower quartile of each pixel from its trimmed mean and std", () =>
{
   const low = core.dppLowerLevel( Float32Array.of( 1000, 2000 ), Float32Array.of( 0, 10 ) );
   assert.ok( low instanceof Float32Array );
   assert.equal( low[ 0 ], 1000 );
   assert.ok( Math.abs( low[ 1 ] - ( 2000 - 6.745 ) ) < 1e-3 );
   assert.throws( () => core.dppLowerLevel( Float32Array.of( 1, 2 ), Float32Array.of( 1 ) ), /size/ );
} );

/** normal pixels, warm/hot pixels with shot noise, and pixels that jump upward every other frame (Canon type) */
function upwardScene( n, seed )
{
   const r = rng( seed );
   const normal = 20000, jumping = 300, warm = 460;
   const length = normal + jumping + warm;
   const frames = Array.from( { length: n }, () => new Uint16Array( length ) );
   const excess = new Float64Array( length );
   for ( let i = normal + jumping; i < length; ++i )
      excess[ i ] = 100 * Math.pow( ( i < length - 60 ) ? 20 : 300, r.uniform() );
   for ( let k = 0; k < n; ++k )
      for ( let i = 0; i < length; ++i )
      {
         const isJumping = i >= normal && i < normal + jumping;
         const jump = ( isJumping && k % 2 === 1 ) ? 100 : 0;          // 12.5 x the normal fluctuation
         frames[ k ][ i ] = Math.round( 2000 + excess[ i ] + jump + Math.sqrt( 64 + 6 * excess[ i ] ) * r.gauss() );
      }
   return { frames, jumping: [ normal, normal + jumping ], warm: [ normal + jumping, length ] };
}

test( "classify flags pixels that jump upward although their jumps raise their mean level", () =>
{
   const scene = upwardScene( 24, 31 );
   const c = core.dppClassify( core.dppPixelStats( scene.frames ), 4, 20 );
   let flagged = 0, warm = 0;
   for ( let i = scene.jumping[ 0 ]; i < scene.jumping[ 1 ]; ++i )
      flagged += c.noisy[ i ];
   for ( let i = scene.warm[ 0 ]; i < scene.warm[ 1 ]; ++i )
      warm += c.noisy[ i ];
   assert.ok( flagged >= 0.95 * ( scene.jumping[ 1 ] - scene.jumping[ 0 ] ), "flagged " + flagged );
   assert.ok( warm <= 2, "warm or hot pixels flagged: " + warm );
} );

test( "classify with an external map counts that map instead", () =>
{
   const scene = darkScene( 12, 2000, 9 );
   const stats = core.dppPixelStats( scene.frames );
   const map = new Uint8Array( 2000 );
   map[ 5 ] = map[ 6 ] = 1;
   const c = core.dppClassify( stats, 4, 20, map );
   assert.equal( c.counts.noisy, 2 );
   assert.equal( c.noisy, map );
   const own = core.dppClassify( stats, 4, 20 );
   assert.equal( c.counts.spikes, own.counts.spikes, "one-frame spikes do not depend on the map" );
   assert.throws( () => core.dppClassify( stats, 4, 20, new Uint8Array( 5 ) ), /size/ );
} );

test( "axis maps values to pixels on linear and log scales", () =>
{
   const lin = core.dppAxis( 0, 100, false, 200 );
   assert.equal( lin.pos( 0 ), 0 );
   assert.equal( lin.pos( 50 ), 100 );
   const log = core.dppAxis( 10, 1000, true, 200 );
   assert.ok( Math.abs( log.pos( 100 ) - 100 ) < 1e-9 );
} );

test( "ticks are round numbers inside the range", () =>
{
   assert.deepEqual( core.dppLogTicks( 25, 2500 ), [ 30, 50, 100, 200, 300, 500, 1000, 2000 ] );
   assert.deepEqual( core.dppLinearTicks( 2330, 3010, 8 ), [ 2400, 2500, 2600, 2700, 2800, 2900, 3000 ] );
} );

test( "decadeTicks lists the powers of ten inside the range", () =>
{
   assert.deepEqual( core.dppDecadeTicks( 10, 10000 ), [ 10, 100, 1000, 10000 ] );
   assert.deepEqual( core.dppDecadeTicks( 25, 2500 ), [ 100, 1000 ] );
   assert.deepEqual( core.dppDecadeTicks( 0, 100 ), [] );
} );

test( "decadeLabel writes powers of ten with superscript exponents", () =>
{
   assert.equal( core.dppDecadeLabel( 10 ), "10¹" );
   assert.equal( core.dppDecadeLabel( 10000 ), "10⁴" );
   assert.equal( core.dppDecadeLabel( 1e12 ), "10¹²" );
   assert.equal( core.dppDecadeLabel( 1 ), "10⁰" );
} );

test( "yRange gives the fixed apranat range or a data-driven one", () =>
{
   const std = Float32Array.from( { length: 1000 }, ( _, i ) => 50 + i );
   assert.deepEqual( core.dppYRange( std, true ), [ 10, 10000 ] );
   const auto = core.dppYRange( std, false );
   assert.ok( auto[ 0 ] > 30 && auto[ 0 ] < 50 && auto[ 1 ] > 1049 );
} );

test( "ticks return nothing for degenerate ranges instead of looping", () =>
{
   assert.deepEqual( core.dppLogTicks( 0, 1000 ), [] );
   assert.deepEqual( core.dppLogTicks( -5, 1000 ), [] );
   assert.deepEqual( core.dppLogTicks( 100, 100 ), [] );
   assert.deepEqual( core.dppLinearTicks( 2600, 2600, 10 ), [] );
   assert.deepEqual( core.dppLinearTicks( 2600, NaN, 10 ), [] );
} );

test( "classify stays finite when the typical fluctuation is zero", () =>
{
   const frames = Array.from( { length: 8 }, () => new Uint16Array( 500 ).fill( 1000 ) );
   frames[ 3 ][ 7 ] = 1100;   // one spike
   const c = core.dppClassify( core.dppPixelStats( frames ), 4, 20 );
   assert.equal( c.counts.noisy, 0, "a flat set has no noisy pixels" );
   assert.ok( Number.isFinite( c.noisyStdRatio ) );
} );

test( "densityGrid counts points per cell with row 0 at the top", () =>
{
   const xs = Float32Array.from( [ 0.5, 0.5, 9.5, 20 ] ), ys = Float32Array.from( [ 0.5, 0.5, 9.5, 5 ] );
   const g = core.dppDensityGrid( xs, ys, core.dppAxis( 0, 10, false, 10 ), core.dppAxis( 0, 10, false, 10 ) );
   assert.equal( g.width, 10 );
   assert.equal( g.counts[ 9 * 10 + 0 ], 2, "bottom-left cell" );
   assert.equal( g.counts[ 0 * 10 + 9 ], 1, "top-right cell" );
   assert.equal( g.max, 2 );
   assert.equal( g.counts.reduce( ( a, v ) => a + v, 0 ), 3, "out-of-range point skipped" );
} );

test( "densityGrid places every point at its exact value (no jitter)", () =>
{
   const xs = new Float32Array( 1000 ).fill( 5 ), ys = new Float32Array( 1000 ).fill( 5 );
   const g = core.dppDensityGrid( xs, ys, core.dppAxis( 0, 10, false, 100 ), core.dppAxis( 0, 10, false, 10 ) );
   const used = [];
   for ( let x = 0; x < 100; ++x ) if ( g.counts[ 4 * 100 + x ] ) used.push( x );
   assert.deepEqual( used, [ 50 ] );
} );

test( "alignedZoom maps each value step to a whole number of pixels, with values at pixel centres", () =>
{
   const z = core.dppAlignedZoom( 2780, 2816, 2, 1010, 2796 );
   assert.equal( z.pxPerStep, 56 );
   assert.ok( Number.isInteger( z.pxPerStep ) );
   assert.ok( z.max - z.min >= 36 - 2 );
   const ax = core.dppAxis( z.min, z.max, false, 1010 );
   for ( const v of [ 2780, 2796, 2810 ] )
      assert.ok( Math.abs( ax.pos( v ) % 1 - 0.5 ) < 1e-6, "value " + v + " at a pixel centre: " + ax.pos( v ) );
   assert.ok( Math.abs( ( ax.pos( 2798 ) - ax.pos( 2796 ) ) - 56 ) < 1e-6 );
} );

test( "alignedZoom keeps the range when the step is finer than a pixel or unknown", () =>
{
   assert.equal( core.dppAlignedZoom( 2330, 3000, 2, 1010, 2668 ).pxPerStep, 3 );
   assert.deepEqual( core.dppAlignedZoom( 1000, 4000, 2, 1010, 2500 ), { min: 1000, max: 4000, pxPerStep: 0 } );
   assert.deepEqual( core.dppAlignedZoom( 10, 20, 0, 1010, 15 ), { min: 10, max: 20, pxPerStep: 0 } );
} );

test( "columnWidth makes discrete columns visible without turning them into blocks", () =>
{
   assert.equal( core.dppColumnWidth( 0 ), 1 );
   assert.equal( core.dppColumnWidth( 2 ), 1 );
   assert.equal( core.dppColumnWidth( 12 ), 3 );
   assert.equal( core.dppColumnWidth( 56 ), 6 );
} );

test( "widenColumns spreads each column sideways without changing the input", () =>
{
   const grid = { counts: Uint32Array.from( [ 0, 0, 5, 0, 0, 0, 0, 0, 0, 1 ] ), width: 10, height: 1, max: 5 };
   const w = core.dppWidenColumns( grid, 3 );
   assert.deepEqual( Array.from( w.counts ), [ 0, 5, 5, 5, 0, 0, 0, 0, 1, 1 ] );
   assert.equal( w.max, 5 );
   assert.deepEqual( Array.from( grid.counts ), [ 0, 0, 5, 0, 0, 0, 0, 0, 0, 1 ], "input untouched" );
   assert.equal( core.dppWidenColumns( grid, 1 ).counts[ 2 ], 5 );
} );

test( "quantum finds the value step of quantized medians", () =>
{
   const v = Float32Array.from( { length: 5000 }, ( _, i ) => 2600 + 2 * ( i % 50 ) );
   assert.equal( core.dppQuantum( v ), 2 );
   assert.equal( core.dppQuantum( Float32Array.from( [ 1, 1, 1 ] ) ), 0 );
} );

test( "rampColor goes from the lightest to the darkest step", () =>
{
   const lo = core.dppRampColor( 0 ), hi = core.dppRampColor( 1 );
   assert.ok( lo[ 0 ] + lo[ 1 ] + lo[ 2 ] > hi[ 0 ] + hi[ 1 ] + hi[ 2 ] );
   assert.deepEqual( core.dppRampColor( -1 ), lo );
   assert.deepEqual( core.dppRampColor( 2 ), hi );
} );

test( "percentile picks the value at the requested rank", () =>
{
   const v = Float32Array.from( { length: 1001 }, ( _, i ) => i );
   assert.equal( core.dppPercentile( v, 0 ), 0 );
   assert.equal( core.dppPercentile( v, 50 ), 500 );
   assert.equal( core.dppPercentile( v, 100 ), 1000 );
} );

test( "formatInt adds thousands separators", () =>
{
   assert.equal( core.dppFormatInt( 60869 ), "60,869" );
   assert.equal( core.dppFormatInt( 12 ), "12" );
} );
