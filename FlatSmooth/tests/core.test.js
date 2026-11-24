"use strict";

const test = require( "node:test" );
const assert = require( "node:assert/strict" );
const core = require( "../FlatSmooth-Core.js" );

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

/** Vignetted CFA flat: 4 colour levels, smooth shading, relative white noise. */
function cfaFlat( w, h, noise, seed )
{
   const r = rng( seed );
   const levels = [ 0.30, 0.40, 0.40, 0.20 ];   // phase (0,0) (1,0) (0,1) (1,1)
   const truth = new Float64Array( w * h ), flat = new Float32Array( w * h );
   for ( let y = 0; y < h; ++y )
      for ( let x = 0; x < w; ++x )
      {
         const d2 = ( ( x - w / 2 ) ** 2 + ( y - h / 2 ) ** 2 ) / ( w * w / 4 );
         const t = levels[ ( x & 1 ) + 2 * ( y & 1 ) ] * ( 1 - 0.3 * d2 );
         truth[ y * w + x ] = t;
         flat[ y * w + x ] = t * ( 1 + noise * r.gauss() );
      }
   return { truth, flat };
}

test( "fsBoxMean matches a brute-force mean with replicated edges", () =>
{
   const w = 7, h = 5, r = 2;
   const plane = Float64Array.from( { length: w * h }, ( _, i ) => ( i * 37 ) % 11 );
   const got = core.fsBoxMean( plane, w, h, r );
   const clamp = ( v, n ) => Math.min( n - 1, Math.max( 0, v ) );
   for ( let y = 0; y < h; ++y )
      for ( let x = 0; x < w; ++x )
      {
         let s = 0;
         for ( let j = -r; j <= r; ++j )
            for ( let i = -r; i <= r; ++i )
               s += plane[ clamp( y + j, h ) * w + clamp( x + i, w ) ];
         assert.ok( Math.abs( got[ y * w + x ] - s / 25 ) < 1e-12, `(${x},${y})` );
      }
} );

test( "fsNoiseFactor equals the measured noise reduction of the smoothing", () =>
{
   const w = 300, h = 300, r = rng( 1 );
   const noise = Float64Array.from( { length: w * h }, () => r.gauss() );
   let out = noise;
   for ( let p = 0; p < core.FS_SMOOTH_PASSES; ++p )
      out = core.fsBoxMean( out, w, h, 3 );
   const inner = [];
   for ( let y = 30; y < h - 30; ++y )
      for ( let x = 30; x < w - 30; ++x )
         inner.push( out[ y * w + x ] );
   const measured = Math.sqrt( inner.reduce( ( s, v ) => s + v * v, 0 ) / inner.length );
   const predicted = core.fsNoiseFactor( 3, core.FS_SMOOTH_PASSES );
   assert.ok( Math.abs( measured / predicted - 1 ) < 0.15, `measured ${measured} predicted ${predicted}` );
   assert.equal( core.fsNoiseFactor( 0, 3 ), 1 );
} );

test( "fsChooseRadius returns 0 for a quiet flat and grows with the noise", () =>
{
   assert.equal( core.fsChooseRadius( 0.002, 0.003, 3 ), 0 );
   const r1 = core.fsChooseRadius( 0.01, 0.003, 3 ), r2 = core.fsChooseRadius( 0.06, 0.003, 3 );
   assert.ok( r1 >= 1 && r2 > r1, `${r1} ${r2}` );
   assert.ok( 0.06 * core.fsNoiseFactor( r2, 3 ) <= 0.003 );
   assert.ok( 0.06 * core.fsNoiseFactor( r2 - 1, 3 ) > 0.003 );
   assert.equal( core.fsChooseRadius( 10, 1e-9, 3 ), core.FS_MAX_RADIUS );
} );

test( "fsAnalyzePlane measures the relative noise of each CFA phase", () =>
{
   const { flat } = cfaFlat( 400, 300, 0.06, 2 );
   const phases = core.fsAnalyzePlane( flat, 400, 300, 2 );
   assert.equal( phases.length, 4 );
   for ( const p of phases )
      assert.ok( Math.abs( p.noise / 0.06 - 1 ) < 0.08, `phase ${p.dx},${p.dy}: ${p.noise}` );
   assert.ok( phases[ 3 ].mean < phases[ 0 ].mean && phases[ 0 ].mean < phases[ 1 ].mean );
} );

test( "fsSmoothPlane removes pixel noise, keeps shading and never mixes CFA colours", () =>
{
   const w = 400, h = 300;
   const { truth, flat } = cfaFlat( w, h, 0.06, 3 );
   const radius = 4;
   const { plane } = core.fsSmoothPlane( flat, w, h, 2, radius, core.FS_SMOOTH_PASSES );
   assert.notEqual( plane, flat );
   const before = [], after = [];
   for ( let y = 40; y < h - 40; ++y )
      for ( let x = 40; x < w - 40; ++x )
      {
         const i = y * w + x;
         before.push( flat[ i ] / truth[ i ] - 1 );
         after.push( plane[ i ] / truth[ i ] - 1 );
      }
   const rms = a => Math.sqrt( a.reduce( ( s, v ) => s + v * v, 0 ) / a.length );
   const expected = 0.06 * core.fsNoiseFactor( radius, core.FS_SMOOTH_PASSES );
   assert.ok( rms( after ) < 1.5 * expected, `after ${rms( after )} expected ~${expected}` );
   assert.ok( rms( after ) < rms( before ) / 10 );
} );

test( "fsSmoothPlane clips hot, dead and non-finite pixels before smoothing", () =>
{
   const w = 120, h = 100;
   const { flat } = cfaFlat( w, h, 0.002, 4 );
   const bad = [ 50 * w + 60, 20 * w + 20, 70 * w + 81 ];
   const dirty = Float32Array.from( flat );
   dirty[ bad[ 0 ] ] = 1.0; dirty[ bad[ 1 ] ] = 0; dirty[ bad[ 2 ] ] = NaN;
   const { plane, clipped } = core.fsSmoothPlane( dirty, w, h, 2, 3, core.FS_SMOOTH_PASSES );
   assert.ok( clipped >= 3 && clipped < 40, `clipped ${clipped}` );
   for ( let i = 0; i < plane.length; ++i )
      assert.ok( Number.isFinite( plane[ i ] ) );
   // the bad pixels must not disturb the result: compare with the clean flat smoothed the same way
   const clean = core.fsSmoothPlane( flat, w, h, 2, 3, core.FS_SMOOTH_PASSES ).plane;
   for ( const i of bad )
      assert.ok( Math.abs( plane[ i ] / clean[ i ] - 1 ) < 0.002, `pixel ${i}: ${plane[ i ]} vs ${clean[ i ]}` );
} );

test( "fsSmoothPlane with step 1 smooths a plain (non-CFA) plane", () =>
{
   const w = 100, h = 80, r = rng( 5 );
   const flat = Float32Array.from( { length: w * h }, () => 0.5 * ( 1 + 0.05 * r.gauss() ) );
   const phases = core.fsAnalyzePlane( flat, w, h, 1 );
   assert.equal( phases.length, 1 );
   const { plane } = core.fsSmoothPlane( flat, w, h, 1, 5, core.FS_SMOOTH_PASSES );
   assert.ok( core.fsAnalyzePlane( plane, w, h, 1 )[ 0 ].noise < phases[ 0 ].noise / 5 );
} );
