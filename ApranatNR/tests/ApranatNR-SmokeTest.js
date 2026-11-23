// ----------------------------------------------------------------------------
// ApranatNR-SmokeTest.js - end-to-end check inside the PJSR runtime.
//
// Run non-interactively (a separate PixInsight instance):
//   PixInsight -n --automation-mode --no-startup-scripts -r=<this file> --force-exit
// Writes a report to <system temp>/ApranatNR-smoke/report.txt
// ----------------------------------------------------------------------------

#engine v8

#include <pjsr/utility/ScriptErrors.js>
#include "../ApranatNR-Version.js"
#include "../ApranatNR-Core.js"
#include "../ApranatNR-IO.js"
#include "../ApranatNR-Engine.js"
#include "../ApranatNR-Strings.js"
#include "../ApranatNR-GUI.js"

const SMOKE_W = 64;
const SMOKE_H = 48;
const SMOKE_LIGHTS = 20;
const SMOKE_DARKS = 16;
const SMOKE_BACKGROUND = 0.1;
const SMOKE_COOL_PIXELS = [ [ 10, 10 ], [ 30, 20 ], [ 50, 40 ] ];
const SMOKE_RTN_PIXELS = [ [ 20, 30 ], [ 40, 12 ] ];
const SMOKE_RTN_JUMP = 0.03;              // ~3 sigma of the light frame noise
const SMOKE_STAR = { x: 12, y: 36, peak: 0.5, sigma: 1.2 };   // sits on an RTN pixel
const SMOKE_ALL_RTN = SMOKE_RTN_PIXELS.concat( [ [ SMOKE_STAR.x, SMOKE_STAR.y ] ] );
const SMOKE_COSMIC = { frame: 5, x: 33, y: 25 };

const smokeReport = [];
let smokeFailures = 0;

function smokeCheck( isOk, text )
{
   smokeReport.push( ( isOk ? "PASS " : "FAIL " ) + text );
   if ( !isOk )
      ++smokeFailures;
}

function smokeRandom( seed )
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

function smokeIndex( xy )
{
   return xy[ 1 ] * SMOKE_W + xy[ 0 ];
}

function smokeMakeFiles( dir )
{
   const rng = smokeRandom( 42 );
   const keywords = [ new FITSKeyword( "EXPTIME", "30", "Exposure time [s]" ) ];
   const lights = [];
   for ( let k = 0; k < SMOKE_LIGHTS; ++k )
   {
      const f = new Float32Array( SMOKE_W * SMOKE_H );
      for ( let i = 0; i < f.length; ++i )
      {
         const dx = ( i % SMOKE_W ) - SMOKE_STAR.x, dy = Math.floor( i / SMOKE_W ) - SMOKE_STAR.y;
         const star = SMOKE_STAR.peak * Math.exp( -( dx * dx + dy * dy ) / ( 2 * SMOKE_STAR.sigma * SMOKE_STAR.sigma ) );
         f[ i ] = SMOKE_BACKGROUND + star + 0.01 * rng.gauss();
      }
      SMOKE_COOL_PIXELS.forEach( xy => { f[ smokeIndex( xy ) ] *= 0.5; } );
      SMOKE_ALL_RTN.forEach( xy => { f[ smokeIndex( xy ) ] += ( rng.uniform() < 0.5 ) ? SMOKE_RTN_JUMP : -SMOKE_RTN_JUMP; } );
      if ( k === SMOKE_COSMIC.frame )
         f[ smokeIndex( [ SMOKE_COSMIC.x, SMOKE_COSMIC.y ] ) ] = 1.0;
      const path = dir + format( "/light_%02d.xisf", k );
      anrWriteImage( path, [ f ], SMOKE_W, SMOKE_H, { keywords: keywords }, [] );
      lights.push( path );
   }

   const darks = [];
   for ( let k = 0; k < SMOKE_DARKS; ++k )
   {
      const f = new Float32Array( SMOKE_W * SMOKE_H );
      for ( let i = 0; i < f.length; ++i )
         f[ i ] = 0.01 + 0.001 * rng.gauss();
      SMOKE_ALL_RTN.forEach( xy => { f[ smokeIndex( xy ) ] = ( rng.uniform() < 0.5 ) ? 0.02 : 0.0; } );
      const path = dir + format( "/dark_%02d.xisf", k );
      anrWriteImage( path, [ f ], SMOKE_W, SMOKE_H, {}, [] );
      darks.push( path );
   }
   return { lights: lights, darks: darks };
}

function smokeMeanAt( paths, index )
{
   return paths.reduce( ( sum, path ) => sum + anrReadFrame( path ).planes[ 0 ][ index ], 0 ) / paths.length;
}

function smokeStageA( dir, files )
{
   const p = new AnrParameters;
   p.lightFiles = files.lights;
   p.darkFiles = files.darks;
   p.rtnEnabled = true;
   p.coolEnabled = true;
   p.outputDir = dir + "/out";
   p.overwrite = true;
   const outputs = anrRunStageA( p );

   smokeCheck( outputs.length === SMOKE_LIGHTS, "Stage A wrote " + outputs.length + " frames" );

   const map = anrReadFrame( p.outputDir + "/rtn_defect_map.xisf" ).planes[ 0 ];
   const flagged = map.reduce( ( a, v ) => a + ( v > 0.5 ? 1 : 0 ), 0 );
   smokeCheck( SMOKE_ALL_RTN.every( xy => map[ smokeIndex( xy ) ] > 0.5 ), "defect map flags all RTN pixels" );
   smokeCheck( flagged <= SMOKE_ALL_RTN.length + 2, "defect map has few false positives (" + flagged + ")" );

   const cool = anrReadFrame( p.outputDir + "/coolfile.xisf" ).planes[ 0 ];
   SMOKE_COOL_PIXELS.forEach( xy =>
   {
      const v = cool[ smokeIndex( xy ) ];
      smokeCheck( Math.abs( v - 0.5 * SMOKE_BACKGROUND ) < 0.01, format( "cool file at (%d,%d) = %.4f", xy[ 0 ], xy[ 1 ], v ) );
   } );

   SMOKE_COOL_PIXELS.forEach( xy =>
   {
      const m = smokeMeanAt( outputs, smokeIndex( xy ) );
      smokeCheck( Math.abs( m - SMOKE_BACKGROUND ) < 0.006, format( "corrected mean at cool (%d,%d) = %.4f", xy[ 0 ], xy[ 1 ], m ) );
   } );

   const rtnIndex = smokeIndex( SMOKE_RTN_PIXELS[ 0 ] );
   const worst = outputs.reduce( ( w, path ) =>
      Math.max( w, Math.abs( anrReadFrame( path ).planes[ 0 ][ rtnIndex ] - SMOKE_BACKGROUND ) ), 0 );
   smokeCheck( worst < 0.02, format( "RTN pixel per-frame deviation after mapping <= %.4f", worst ) );

   const starIndex = smokeIndex( [ SMOKE_STAR.x, SMOKE_STAR.y ] );
   const starIn = smokeMeanAt( files.lights, starIndex );
   const starOut = smokeMeanAt( outputs, starIndex );
   smokeCheck( Math.abs( starOut - starIn ) < 1e-6,
               format( "star core on an RTN pixel kept (%.4f -> %.4f)", starIn, starOut ) );

   const first = anrReadFrame( outputs[ 0 ] );
   smokeCheck( first.keywords.some( k => k.name === "EXPTIME" ), "source keywords preserved" );
   smokeCheck( first.keywords.filter( k => k.name === "HISTORY" ).length === 2, "history keywords added" );
   return outputs;
}

function smokeStageB( dir, registered )
{
   const p = new AnrParameters;
   p.registeredFiles = registered;
   p.cosmicutOutputDir = dir + "/out";
   p.cosmicutSaveMax = true;
   p.overwrite = true;
   const masterPath = anrRunStageB( p );

   const master = anrReadFrame( masterPath );
   const v = master.planes[ 0 ][ smokeIndex( [ SMOKE_COSMIC.x, SMOKE_COSMIC.y ] ) ];
   smokeCheck( Math.abs( v - SMOKE_BACKGROUND ) < 0.01, format( "cosmic ray removed by Cosmicut (%.4f)", v ) );
   const ncombine = master.keywords.filter( k => k.name === "NCOMBINE" );
   smokeCheck( ncombine.length === 1 && ncombine[ 0 ].strippedValue.trim() === String( SMOKE_LIGHTS ), "NCOMBINE keyword" );
   const maxMap = anrReadFrame( p.cosmicutOutputDir + "/cosmicut_rejected_max.xisf" ).planes[ 0 ];
   smokeCheck( maxMap[ smokeIndex( [ SMOKE_COSMIC.x, SMOKE_COSMIC.y ] ) ] > 0.99, "rejected max map contains the hit" );
}

function smokeNoSourceOverwrite( dir, files )
{
   const p = new AnrParameters;
   p.lightFiles = files.lights.slice( 0, 4 );
   p.coolEnabled = true;
   p.outputDir = dir;
   p.outputSuffix = "";
   p.overwrite = true;
   const before = anrReadFrame( p.lightFiles[ 0 ] ).planes[ 0 ][ smokeIndex( SMOKE_COOL_PIXELS[ 0 ] ) ];
   const outputs = anrRunStageA( p );
   const after = anrReadFrame( p.lightFiles[ 0 ] ).planes[ 0 ][ smokeIndex( SMOKE_COOL_PIXELS[ 0 ] ) ];
   smokeCheck( outputs.every( ( o, i ) => o !== p.lightFiles[ i ] ), "outputs never reuse a source path" );
   smokeCheck( before === after, "source light untouched with empty suffix + overwrite" );
}

function smokeCfaDetection( dir )
{
   const path = dir + "/cfa.xisf";
   anrWriteImage( path, [ new Float32Array( 16 ).fill( 0.1 ) ], 4, 4,
                  { keywords: [ new FITSKeyword( "BAYERPAT", "'RGGB'", "" ) ] }, [] );
   const frame = anrReadFrame( path );
   smokeCheck( anrResolveStep( ANR_CFA_AUTO, frame ) === 2, "BAYERPAT auto-detects CFA step 2" );
   smokeCheck( anrResolveStep( ANR_CFA_MONO, frame ) === 1, "manual mono override" );
}

function smokeDialog()
{
   ANR_LANGUAGES.forEach( language =>
   {
      anrSetLanguage( language );
      const dialog = new AnrDialog( new AnrParameters );
      smokeCheck( dialog.tabs.numberOfPages === 2 && dialog.tabs.pageLabel( 0 ) === anrText( "tabStageA" ),
                  "dialog builds with 2 tabs (" + language + ")" );
   } );
   anrSetLanguage( "en" );
}

function smokeMain()
{
   const dir = File.systemTempDirectory + "/ApranatNR-smoke";
   anrEnsureDirectory( dir );
   const reportPath = dir + "/report.txt";
   try
   {
      const files = smokeMakeFiles( dir );
      const corrected = smokeStageA( dir, files );
      smokeStageB( dir, corrected );
      smokeNoSourceOverwrite( dir, files );
      smokeCfaDetection( dir );
      smokeDialog();
   }
   catch ( x )
   {
      smokeCheck( false, "exception: " + ScriptErrors.message( x ) + "\n" + ( x.stack || "" ) );
   }
   smokeReport.push( smokeFailures === 0 ? "RESULT: PASS" : "RESULT: FAIL (" + smokeFailures + ")" );
   File.writeTextFile( reportPath, smokeReport.join( "\n" ) + "\n" );
   console.writeln( smokeReport.join( "\n" ) );
}

smokeMain();
