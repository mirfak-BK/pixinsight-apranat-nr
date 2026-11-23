// ----------------------------------------------------------------------------
// check.js - verifies the WBPP end-to-end runs made by run.sh.
// Argument: base directory. Writes <base>/report.txt.
//   <base>/out      WBPP + ApranatNR builder, valid settings (Cosmicut on)
//   <base>/out-bad  WBPP + ApranatNR builder, invalid settings
// ----------------------------------------------------------------------------

#engine v8

#include "../../ApranatNR-Version.js"
#include "../../ApranatNR-Core.js"
#include "../../ApranatNR-IO.js"

const e2eReport = [];
let e2eFailures = 0;

function e2eCheck( isOk, text )
{
   e2eReport.push( ( isOk ? "PASS " : "FAIL " ) + text );
   if ( !isOk )
      ++e2eFailures;
}

function e2eFiles( dir, pattern )
{
   return File.directoryExists( dir ) ? searchDirectory( dir + "/" + pattern, false ).sort() : [];
}

function e2eSubdirectories( dir )
{
   const out = [];
   if ( !File.directoryExists( dir ) )
      return out;
   const find = new FileFind;
   if ( find.begin( dir + "/" + "*" ) )
      do
         if ( find.isDirectory && find.name !== "." && find.name !== ".." )
            out.push( dir + "/" + find.name );
      while ( find.next() );
   find.end();
   return out;
}

function e2eLogText( outDir )
{
   const logs = e2eFiles( outDir + "/logs", "*.log" );
   return ( logs.length > 0 ) ? File.readTextFile( logs[ 0 ] ) : "";
}

// mean |pixel - same-color neighbor median| at the given sensor positions
function e2eDeviation( data, w, h, positions )
{
   const buf = new Float64Array( 8 );
   return positions.reduce( ( sum, [ x, y ] ) =>
      sum + Math.abs( data[ y * w + x ] - anrNeighborMedian( data, w, h, x, y, 2, null, buf ) ), 0 ) / positions.length;
}

function e2eCheckGoodRun( base, truth )
{
   const out = base + "/out";
   const groups = e2eSubdirectories( out + "/apranatnr" );
   e2eCheck( groups.length === 1, "one ApranatNR group folder (" + groups.length + ")" );
   if ( groups.length !== 1 )
      return;
   const anrDir = groups[ 0 ];
   const corrected = e2eFiles( anrDir, "*_c_anr.xisf" );
   e2eCheck( corrected.length === truth.lights, "corrected frames: " + corrected.length );

   const map = anrReadFrame( anrDir + "/rtn_defect_map.xisf" ).planes[ 0 ];
   const found = truth.rtn.filter( ( [ x, y ] ) => map[ y * truth.width + x ] > 0.5 ).length;
   const flagged = map.reduce( ( a, v ) => a + ( v > 0.5 ? 1 : 0 ), 0 );
   e2eCheck( found >= 0.9 * truth.rtn.length, format( "RTN map from the WBPP darks finds %d/%d RTN pixels", found, truth.rtn.length ) );
   e2eCheck( flagged <= truth.rtn.length + 20, "RTN map size " + flagged );

   const cool = anrReadFrame( anrDir + "/coolfile.xisf" ).planes[ 0 ];
   const coolFound = truth.cool.filter( ( [ x, y ] ) => cool[ y * truth.width + x ] > 0 ).length;
   e2eCheck( coolFound >= 0.8 * truth.cool.length, format( "cool file finds %d/%d cool pixels", coolFound, truth.cool.length ) );

   // folder names contain dots (EXPOSURE-60.00s), so no File.extractName() here
   const groupFolder = anrDir.substring( anrDir.lastIndexOf( "/" ) + 1 );
   let rtnBefore = 0, rtnAfter = 0, coolBefore = 0, coolAfter = 0;
   corrected.forEach( anrPath =>
   {
      const name = File.extractName( anrPath ).replace( /_anr$/, "" );
      const before = anrReadFrame( out + "/calibrated/" + groupFolder + "/" + name + ".xisf" ).planes[ 0 ];
      const after = anrReadFrame( anrPath ).planes[ 0 ];
      rtnBefore += e2eDeviation( before, truth.width, truth.height, truth.rtn );
      rtnAfter += e2eDeviation( after, truth.width, truth.height, truth.rtn );
      coolBefore += e2eDeviation( before, truth.width, truth.height, truth.cool );
      coolAfter += e2eDeviation( after, truth.width, truth.height, truth.cool );
   } );
   e2eCheck( rtnAfter < 0.6 * rtnBefore, format( "RTN deviation reduced %.2e -> %.2e", rtnBefore, rtnAfter ) );
   e2eCheck( coolAfter < 0.5 * coolBefore, format( "cool deviation reduced %.2e -> %.2e", coolBefore, coolAfter ) );

   const history = anrReadFrame( corrected[ 0 ] ).keywords.filter( k => k.name === "HISTORY" ).map( k => k.comment ).join( "|" );
   e2eCheck( /RTN pixel mapping/.test( history ) && /cool file correction/.test( history ), "HISTORY of corrected frames" );

   const debayered = e2eSubdirectories( out + "/debayered" ).map( d => e2eFiles( d, "*.xisf" ) ).reduce( ( a, b ) => a.concat( b ), [] );
   e2eCheck( debayered.length === truth.lights && debayered.every( p => /_c_anr_d\.xisf$/.test( p ) ),
             "WBPP debayered the ApranatNR frames (" + debayered.length + ")" );

   const masters = e2eFiles( out + "/master", "masterLight_*.xisf" );
   e2eCheck( masters.some( p => /_RGB\.xisf$/.test( p ) ), "WBPP master light written" );
   e2eCheck( masters.some( p => /_cosmicut\.xisf$/.test( p ) ), "Cosmicut master written next to it" );

   const log = e2eLogText( out );
   e2eCheck( /ApranatNR: 12 frames \(RTN from 10 darks \+ cool file\)/.test( log ), "process log reports the ApranatNR step" );
   const failed = log.match( /Execution summary: (\d+) operation\(s\) failed/ );
   e2eCheck( !failed || failed[ 1 ] === "0", "no failed WBPP operation" + ( failed ? " (" + failed[ 1 ] + ")" : "" ) );
}

function e2eCheckBadRun( base )
{
   const out = base + "/out-bad";
   const log = e2eLogText( out );
   e2eCheck( /ApranatNR WBPP settings: "coolSigma" must be between 0 and 10/.test( log ), "invalid settings reported in the log" );
   const debayered = e2eSubdirectories( out + "/debayered" ).map( d => e2eFiles( d, "*.xisf" ) ).reduce( ( a, b ) => a.concat( b ), [] );
   e2eCheck( debayered.length === 0, "run stopped before the light frames were debayered (" + debayered.length + ")" );
   e2eCheck( e2eFiles( out + "/master", "masterLight_*.xisf" ).length === 0, "no master light without ApranatNR" );
}

{
   const args = ( typeof jsArguments !== "undefined" ) ? jsArguments : [];
   const base = ( args.length > 0 ) ? args[ 0 ] : File.systemTempDirectory + "/ApranatNR-wbpp-e2e";
   try
   {
      const truth = JSON.parse( File.readTextFile( base + "/truth.json" ) );
      e2eCheckGoodRun( base, truth );
      e2eCheckBadRun( base );
   }
   catch ( x )
   {
      e2eCheck( false, "exception: " + x.toString() + "\n" + ( x.stack || "" ) );
   }
   e2eReport.push( e2eFailures === 0 ? "RESULT: PASS" : "RESULT: FAIL (" + e2eFailures + ")" );
   File.writeTextFile( base + "/report.txt", e2eReport.join( "\n" ) + "\n" );
}
