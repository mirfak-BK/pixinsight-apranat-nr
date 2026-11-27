// ----------------------------------------------------------------------------
// make-data.js - synthetic Bayer CFA lights + individual darks for the WBPP
// end-to-end test (see run.sh). Argument: base directory. Writes the folders
// <base>/data/lights and <base>/data/darks (XISF) and <base>/truth.json.
// N.B. never write a slash followed by an asterisk in a line comment: the PJSR
// preprocessor takes it as the start of a block comment.
// ----------------------------------------------------------------------------

#engine v8

#include "../../ApranatNR-Version.js"
#include "../../ApranatNR-Core.js"
#include "../../ApranatNR-IO.js"

const E2E_W = 512;
const E2E_H = 512;
const E2E_LIGHTS = 12;
const E2E_DARKS = 10;
const E2E_STARS = 220;
const E2E_DITHER = 4;               // px, uniform +/-
const E2E_SKY = 0.2;
const E2E_DARK_LEVEL = 0.01;
const E2E_READ_NOISE = 0.0005;
const E2E_SHOT = 0.00002;           // variance per unit of signal
const E2E_RTN_COUNT = 40;
const E2E_RTN_JUMP = 0.005;         // ~5x dark noise (detected), ~2.4 sigma in lights (repaired)
const E2E_COOL_COUNT = 10;
const E2E_FLATS = 3;                // few, noisy flats: FlatSmooth has to smooth the master
const E2E_FLAT_LEVEL = 0.4;
const E2E_FLAT_NOISE = 0.03;        // relative, per frame
const E2E_CFA_RESPONSE = [ [ 0.8, 1.0 ], [ 1.0, 0.6 ] ];   // RGGB

function e2eRandom( seed )
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
   return {
      uniform: uniform,
      gauss: () => Math.sqrt( -2 * Math.log( Math.max( uniform(), 1e-12 ) ) ) * Math.cos( 2 * Math.PI * uniform() )
   };
}

/** Optical vignetting shared by the lights and the flats, so that flat fielding is exact. */
function e2eVignetting( x, y )
{
   const r2 = ( ( x - E2E_W / 2 ) * ( x - E2E_W / 2 ) + ( y - E2E_H / 2 ) * ( y - E2E_H / 2 ) ) / ( E2E_W * E2E_W / 4 );
   return 1 - 0.3 * r2;
}

function e2eKeywords( type, exposure = "60." )
{
   return [ new FITSKeyword( "IMAGETYP", "'" + type + "'", "" ),
            new FITSKeyword( "EXPTIME", exposure, "Exposure time [s]" ),
            new FITSKeyword( "XBINNING", "1", "" ),
            new FITSKeyword( "YBINNING", "1", "" ),
            new FITSKeyword( "GAIN", "100", "" ),
            new FITSKeyword( "CCD-TEMP", "-10.", "" ),
            new FITSKeyword( "BAYERPAT", "'RGGB'", "" ) ];
}

function e2eDistinctPixels( rng, count, taken )
{
   const out = [];
   while ( out.length < count )
   {
      const x = 8 + Math.floor( rng.uniform() * ( E2E_W - 16 ) );
      const y = 8 + Math.floor( rng.uniform() * ( E2E_H - 16 ) );
      const key = y * E2E_W + x;
      if ( taken.has( key ) )
         continue;
      taken.add( key );
      out.push( [ x, y ] );
   }
   return out;
}

function e2eSky( stars, dx, dy )
{
   const sky = new Float64Array( E2E_W * E2E_H ).fill( E2E_SKY );
   for ( const s of stars )
   {
      const cx = s.x + dx, cy = s.y + dy, r = Math.ceil( 4 * s.sigma );
      for ( let y = Math.max( 0, Math.floor( cy - r ) ); y <= Math.min( E2E_H - 1, Math.ceil( cy + r ) ); ++y )
         for ( let x = Math.max( 0, Math.floor( cx - r ) ); x <= Math.min( E2E_W - 1, Math.ceil( cx + r ) ); ++x )
            sky[ y * E2E_W + x ] += s.peak * Math.exp( -( ( x - cx ) * ( x - cx ) + ( y - cy ) * ( y - cy ) ) / ( 2 * s.sigma * s.sigma ) );
   }
   return sky;
}

function e2eMain( base )
{
   const rng = e2eRandom( 2026 );
   const taken = new Set();
   const rtn = e2eDistinctPixels( rng, E2E_RTN_COUNT, taken );
   const cool = e2eDistinctPixels( rng, E2E_COOL_COUNT, taken );
   const stars = [];
   for ( let i = 0; i < E2E_STARS; ++i )
      stars.push( { x: 10 + rng.uniform() * ( E2E_W - 20 ), y: 10 + rng.uniform() * ( E2E_H - 20 ),
                    peak: 0.03 + 0.6 * Math.pow( rng.uniform(), 3 ), sigma: 1.3 + 0.6 * rng.uniform() } );

   const lightDir = anrEnsureDirectory( base + "/data/lights" );
   const darkDir = anrEnsureDirectory( base + "/data/darks" );
   const isCool = new Uint8Array( E2E_W * E2E_H );
   cool.forEach( ( [ x, y ] ) => { isCool[ y * E2E_W + x ] = 1; } );

   for ( let k = 0; k < E2E_LIGHTS; ++k )
   {
      const sky = e2eSky( stars, E2E_DITHER * ( 2 * rng.uniform() - 1 ), E2E_DITHER * ( 2 * rng.uniform() - 1 ) );
      const f = new Float32Array( E2E_W * E2E_H );
      for ( let y = 0; y < E2E_H; ++y )
         for ( let x = 0; x < E2E_W; ++x )
         {
            const i = y * E2E_W + x;
            const signal = sky[ i ] * E2E_CFA_RESPONSE[ y % 2 ][ x % 2 ] * e2eVignetting( x, y ) * ( isCool[ i ] ? 0.5 : 1 );
            f[ i ] = Math.min( 1, E2E_DARK_LEVEL + signal +
                                  Math.sqrt( E2E_READ_NOISE * E2E_READ_NOISE + E2E_SHOT * signal ) * rng.gauss() );
         }
      rtn.forEach( ( [ x, y ] ) => { f[ y * E2E_W + x ] += ( rng.uniform() < 0.5 ) ? E2E_RTN_JUMP : 0; } );
      anrWriteImage( lightDir + format( "/light_%02d.xisf", k ), [ f ], E2E_W, E2E_H, { keywords: e2eKeywords( "Light Frame" ) }, [] );
   }

   for ( let k = 0; k < E2E_DARKS; ++k )
   {
      const f = new Float32Array( E2E_W * E2E_H );
      for ( let i = 0; i < f.length; ++i )
         f[ i ] = E2E_DARK_LEVEL + E2E_READ_NOISE * rng.gauss();
      rtn.forEach( ( [ x, y ] ) => { f[ y * E2E_W + x ] += ( rng.uniform() < 0.5 ) ? E2E_RTN_JUMP : 0; } );
      anrWriteImage( darkDir + format( "/dark_%02d.xisf", k ), [ f ], E2E_W, E2E_H, { keywords: e2eKeywords( "Dark Frame" ) }, [] );
   }

   const flatDir = anrEnsureDirectory( base + "/data/flats" );
   for ( let k = 0; k < E2E_FLATS; ++k )
   {
      const f = new Float32Array( E2E_W * E2E_H );
      for ( let y = 0; y < E2E_H; ++y )
         for ( let x = 0; x < E2E_W; ++x )
         {
            const level = E2E_FLAT_LEVEL * E2E_CFA_RESPONSE[ y % 2 ][ x % 2 ] * e2eVignetting( x, y );
            f[ y * E2E_W + x ] = level * ( 1 + E2E_FLAT_NOISE * rng.gauss() );
         }
      anrWriteImage( flatDir + format( "/flat_%02d.xisf", k ), [ f ], E2E_W, E2E_H, { keywords: e2eKeywords( "Flat Frame", "1." ) }, [] );
   }

   File.writeTextFile( base + "/truth.json", JSON.stringify( { width: E2E_W, height: E2E_H, lights: E2E_LIGHTS, rtn: rtn, cool: cool } ) );
}

{
   // the console of a -n --automation-mode instance is not visible: report failures in a file
   const args = ( typeof jsArguments !== "undefined" ) ? jsArguments : [];
   const base = ( args.length > 0 ) ? args[ 0 ] : File.systemTempDirectory + "/ApranatNR-wbpp-e2e";
   try
   {
      e2eMain( base );
   }
   catch ( x )
   {
      File.writeTextFile( File.systemTempDirectory + "/ApranatNR-make-data-error.txt",
                          "base=" + base + "\nargs=" + JSON.stringify( args ) + "\n" + x.toString() + "\n" + ( x.stack || "" ) );
   }
}
