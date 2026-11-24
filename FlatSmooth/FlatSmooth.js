// ----------------------------------------------------------------------------
// PixInsight JavaScript Runtime API - PJSR Version 2.0
// ----------------------------------------------------------------------------
// FlatSmooth.js
//
// Checks a master flat for per-pixel noise and smooths it within each CFA
// colour, to stop a noisy flat from causing walking noise.
//
// Interactive: run the script and use the dialog.
// Unattended:  -r="FlatSmooth.js,--out=<xisf>[,--target=<percent>|--radius=<n>][,--cfa=auto|on|off][,--check][,--lang=en|ja],<master flat>"
//              A JSON summary is written to <out>.json (errors to <out>.error.txt).
// N.B. never write a slash followed by an asterisk in a line comment.
// ----------------------------------------------------------------------------

#engine v8

#feature-id    FlatSmooth : Utilities > FlatSmooth

#feature-info  Checks a master flat for per-pixel noise and smooths it within each \
               CFA colour, so that a noisy flat does not cause walking noise.

CoreApplication.ensureMinimumVersion( 1, 9, 6 );

#include <pjsr/utility/ScriptErrors.js>

#include "FlatSmooth-Core.js"
#include "FlatSmooth-Strings.js"
#include "FlatSmooth-Engine.js"
#include "FlatSmooth-GUI.js"

/** Parses unattended arguments; returns { params, check }. */
function fsParseArguments( args )
{
   const p = new FsParameters;
   p.openResult = false;
   let check = false;
   for ( const a of args )
   {
      if ( a === "--check" )
      {
         check = true;
         continue;
      }
      const m = a.match( /^--(out|target|radius|cfa|lang)=(.*)$/ );
      if ( !m )
      {
         if ( a.startsWith( "--" ) )
            throw new Error( "Unknown option: " + a + " (use --out=, --target=, --radius=, --cfa=auto|on|off, --check, --lang=en|ja)" );
         if ( p.inputPath )
            throw new Error( "Only one master flat can be given: " + a );
         p.inputPath = a;
      }
      else if ( m[ 1 ] === "out" )
         p.outputPath = m[ 2 ];
      else if ( m[ 1 ] === "target" )
      {
         p.autoRadius = true;
         p.targetPercent = parseFloat( m[ 2 ] );
      }
      else if ( m[ 1 ] === "radius" )
      {
         p.autoRadius = false;
         p.fixedRadius = Number( m[ 2 ] );
      }
      else if ( m[ 1 ] === "cfa" )
         p.cfaMode = m[ 2 ];
      else
      {
         if ( FS_LANGUAGES.indexOf( m[ 2 ] ) < 0 )
            throw new Error( "--lang must be one of " + FS_LANGUAGES.join( ", " ) + ": " + a );
         p.language = m[ 2 ];
      }
   }
   return { params: p, check: check };
}

function fsUnattended( args )
{
   const outArg = args.map( a => a.match( /^--out=(.*)$/ ) ).filter( m => m )[ 0 ];
   const inArg = args.filter( a => !a.startsWith( "--" ) )[ 0 ];
   const report = outArg ? outArg[ 1 ] : ( inArg ? fsDefaultOutputPath( inArg ) : File.systemTempDirectory + "/FlatSmooth.xisf" );
   const jsonFile = report + ".json", errorFile = report + ".error.txt";
   [ jsonFile, errorFile ].forEach( f => { if ( File.exists( f ) ) File.remove( f ); } );
   try
   {
      const parsed = fsParseArguments( args );
      fsSetLanguage( parsed.params.language || "en" );
      const summary = fsRun( parsed.params, !parsed.check );
      File.writeTextFile( jsonFile, JSON.stringify( summary, null, 2 ) + "\n" );
   }
   catch ( x )
   {
      File.writeTextFile( errorFile, x.toString() + "\n" + ( x.stack || "" ) );
   }
}

function fsMain()
{
   // Runtime.jsArguments replaces the deprecated global jsArguments (kept for older versions)
   const hasRuntime = typeof Runtime !== "undefined" && Runtime.jsArguments !== undefined;
   const args = hasRuntime ? Runtime.jsArguments : ( ( typeof jsArguments !== "undefined" ) ? jsArguments : [] );
   if ( args.length > 0 )
   {
      fsUnattended( args );
      return;
   }
   try
   {
      fsLoadLanguageSetting();
      const params = new FsParameters;
      // a language change closes the dialog and builds it again with the same parameters
      for ( ;; )
      {
         const dialog = new FsDialog( params );
         dialog.execute();
         if ( !dialog.relaunch )
            break;
      }
   }
   catch ( x )
   {
      ScriptErrors.report( x, true/*interactive*/, FS_TITLE );
   }
}

fsMain();
