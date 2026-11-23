// ----------------------------------------------------------------------------
// PixInsight JavaScript Runtime API - PJSR Version 2.0
// ----------------------------------------------------------------------------
// DarkPixelPlot.js
//
// Per-pixel "median vs fluctuation" plot of a dark sequence, as in apranat's
// analysis of drunk (RTN) pixels: https://apranat.exblog.jp/32142709/
//
// Interactive: run the script and use the dialog.
// Unattended:  -r="DarkPixelPlot.js,--out=<png>[,--map=<xisf>][,--title=<text>][,--ratio=<n>][,--yaxis=apranat][,--lang=en|ja],<dark1>,<dark2>,..."
// ----------------------------------------------------------------------------

#engine v8

#feature-id    DarkPixelPlot : Utilities > DarkPixelPlot

#feature-info  Per-pixel median vs fluctuation (standard deviation) plot of a \
               sequence of dark frames, showing normal, hot and drunk (RTN) pixels.

CoreApplication.ensureMinimumVersion( 1, 9, 6 );

#include <pjsr/utility/ScriptErrors.js>

#include "DarkPixelPlot-Core.js"
#include "DarkPixelPlot-Strings.js"
#include "DarkPixelPlot-Engine.js"
#include "DarkPixelPlot-Render.js"
#include "DarkPixelPlot-GUI.js"

function dppParseArguments( args )
{
   const p = new DppParameters;
   p.openResult = false;
   for ( const a of args )
   {
      const m = a.match( /^--(out|map|title|ratio|yaxis|lang)=(.*)$/ );
      if ( !m && a.startsWith( "--" ) )
         throw new Error( "Unknown option: " + a + " (use --out=, --map=, --title=, --ratio=, --yaxis=apranat|auto, --lang=en|ja)" );
      if ( m && m[ 1 ] === "lang" )
      {
         if ( DPP_LANGUAGES.indexOf( m[ 2 ] ) < 0 )
            throw new Error( "--lang must be one of " + DPP_LANGUAGES.join( ", " ) + ": " + a );
         p.language = m[ 2 ];
         continue;
      }
      if ( m && m[ 1 ] === "yaxis" )
      {
         if ( m[ 2 ] !== "apranat" && m[ 2 ] !== "auto" )
            throw new Error( "--yaxis must be 'apranat' or 'auto': " + a );
         p.apranatAxis = m[ 2 ] === "apranat";
         continue;
      }
      if ( !m )
      {
         if ( p.darkFiles.indexOf( a ) < 0 )
            p.darkFiles.push( a );
      }
      else if ( m[ 1 ] === "out" )
         p.outputPath = m[ 2 ];
      else if ( m[ 1 ] === "map" )
         p.mapPath = m[ 2 ];
      else if ( m[ 1 ] === "title" )
         p.title = m[ 2 ];
      else
         p.ratio = parseFloat( m[ 2 ] );
   }
   return p;
}

function dppMain()
{
   // Runtime.jsArguments replaces the deprecated global jsArguments (kept for older versions)
   const hasRuntime = typeof Runtime !== "undefined" && Runtime.jsArguments !== undefined;
   const args = hasRuntime ? Runtime.jsArguments : ( ( typeof jsArguments !== "undefined" ) ? jsArguments : [] );
   if ( args.length > 0 )
   {
      // unattended run: the console of an automation instance is not visible,
      // so failures are written next to the requested output (or to the
      // system temp folder when that is not possible)
      const out = args.map( a => a.match( /^--out=(.*)$/ ) ).filter( m => m ).map( m => dppPngPath( m[ 1 ] ) )[ 0 ]
                  || File.systemTempDirectory + "/" + DPP_DEFAULT_OUTPUT_NAME;
      const errorFile = out + ".error.txt";
      if ( File.exists( errorFile ) )
         File.remove( errorFile );
      try
      {
         const p = dppParseArguments( args );
         dppSetLanguage( p.language || "en" );
         dppRun( p );
      }
      catch ( x )
      {
         const text = x.toString() + "\n" + ( x.stack || "" );
         try
         {
            File.writeTextFile( errorFile, text );
         }
         catch ( y )
         {
            File.writeTextFile( File.systemTempDirectory + "/" + DPP_DEFAULT_OUTPUT_NAME + ".error.txt", text );
         }
      }
      return;
   }

   console.hide();
   try
   {
      dppLoadLanguageSetting();
      const params = new DppParameters;
      // a language change closes the dialog and builds it again with the same parameters
      for ( ;; )
      {
         const dialog = new DppDialog( params );
         dialog.execute();
         if ( !dialog.relaunch )
            break;
      }
   }
   catch ( x )
   {
      ScriptErrors.report( x, true/*interactive*/, DPP_TITLE );
   }
}

dppMain();
