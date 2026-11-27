"use strict";

const test = require( "node:test" );
const assert = require( "node:assert/strict" );
const fs = require( "fs" );
const path = require( "path" );
const wbpp = require( "../ApranatNR-WBPP.js" );
const { buildWbppBuilder, BUILDER_FILE } = require( "../tools/build-wbpp-builder.js" );

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

test( "parseSettings returns the defaults for an empty object", () =>
{
   const s = wbpp.anrWbppParseSettings( "{}" );
   assert.deepEqual( s, wbpp.ANR_WBPP_DEFAULT_SETTINGS );
   assert.notEqual( s, wbpp.ANR_WBPP_DEFAULT_SETTINGS, "a new object, never the shared defaults" );
} );

test( "parseSettings ignores whole-line // comments, including Japanese text", () =>
{
   const text = [
      "// ApranatNR の WBPP 設定",
      "{",
      "   // クールファイルのしきい値",
      "   \"coolSigma\": 4.5,",
      "   \"cosmicutEnabled\": true",
      "}" ].join( "\n" );
   const s = wbpp.anrWbppParseSettings( text );
   assert.equal( s.coolSigma, 4.5 );
   assert.equal( s.cosmicutEnabled, true );
   assert.equal( s.rtnRatio, wbpp.ANR_WBPP_DEFAULT_SETTINGS.rtnRatio );
} );

test( "parseSettings accepts a file saved with a UTF-8 byte order mark", () =>
{
   assert.equal( wbpp.anrWbppParseSettings( "﻿// コメント\n{ \"coolSigma\": 3 }" ).coolSigma, 3 );
   assert.equal( wbpp.anrWbppParseSettings( "﻿{ \"coolSigma\": 3 }" ).coolSigma, 3 );
} );

test( "parseSettings rejects an unknown key, naming it", () =>
{
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"coolSigmaa\": 5 }" ), /coolSigmaa/ );
} );

test( "parseSettings rejects a value of the wrong type", () =>
{
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"rtnRatio\": \"4\" }" ), /rtnRatio/ );
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"coolEnabled\": 1 }" ), /coolEnabled/ );
} );

test( "parseSettings rejects numbers out of range", () =>
{
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"coolSigma\": 12 }" ), /coolSigma/ );
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"rtnRatio\": 1 }" ), /rtnRatio/ );
} );

test( "parseSettings rejects an unknown CFA mode", () =>
{
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"cfaMode\": \"rgb\" }" ), /cfaMode/ );
} );

test( "parseSettings reports malformed JSON clearly", () =>
{
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"coolSigma\": 5, }" ), /settings/i );
   assert.throws( () => wbpp.anrWbppParseSettings( "[ 1, 2 ]" ), /object/ );
} );

test( "the shipped settings file parses", () =>
{
   const text = fs.readFileSync( path.join( __dirname, "..", "ApranatNR-WBPP-Settings.json" ), "utf8" );
   assert.doesNotThrow( () => wbpp.anrWbppParseSettings( text ) );
} );

// ---------------------------------------------------------------------------
// operation placement
// ---------------------------------------------------------------------------

function entry( name, group )
{
   return { name: name, group: group };
}

test( "insertAfterCalibration places each step right after its group's calibration", () =>
{
   const entries = [ entry( "masterDark" ), entry( "calibrate", "L1" ), entry( "footer" ),
                     entry( "calibrate", "L2" ), entry( "footer" ), entry( "debayer", "L1" ) ];
   const result = wbpp.anrWbppInsertAfterCalibration( entries, 1,
      e => e.name === "calibrate" ? e.group : null,
      [ { group: "L1", entry: entry( "anr", "L1" ) }, { group: "L2", entry: entry( "anr", "L2" ) } ] );

   assert.deepEqual( result.map( e => e.name + ( e.group || "" ) ),
                     [ "masterDark", "calibrateL1", "anrL1", "footer", "calibrateL2", "anrL2", "footer", "debayerL1" ] );
   assert.equal( entries.length, 6, "input list untouched" );
} );

test( "insertAfterCalibration puts steps of uncalibrated groups at the start of the light pipeline", () =>
{
   const entries = [ entry( "masterFlat" ), entry( "header" ), entry( "debayer", "L1" ), entry( "debayer", "L2" ) ];
   const result = wbpp.anrWbppInsertAfterCalibration( entries, 1, () => null,
      [ { group: "L1", entry: entry( "anr", "L1" ) }, { group: "L2", entry: entry( "anr", "L2" ) } ] );

   assert.deepEqual( result.map( e => e.name + ( e.group || "" ) ),
                     [ "masterFlat", "anrL1", "anrL2", "header", "debayerL1", "debayerL2" ] );
} );

test( "insertAfterCalibration ignores calibration entries before the light pipeline", () =>
{
   const entries = [ entry( "calibrate", "L1" ), entry( "header" ), entry( "debayer", "L1" ) ];
   const result = wbpp.anrWbppInsertAfterCalibration( entries, 1, e => e.name === "calibrate" ? e.group : null,
      [ { group: "L1", entry: entry( "anr", "L1" ) } ] );
   assert.deepEqual( result.map( e => e.name ), [ "calibrate", "anr", "header", "debayer" ] );
} );

// ---------------------------------------------------------------------------
// RTN source and stage A parameters
// ---------------------------------------------------------------------------

const darks = n => Array.from( { length: n }, ( _, i ) => "/d/dark_" + i + ".fit" );

test( "rtnSource prefers an explicit defect map", () =>
{
   const s = { ...wbpp.ANR_WBPP_DEFAULT_SETTINGS, rtnDefectMapPath: "/maps/rtn.xisf" };
   assert.deepEqual( wbpp.anrWbppRtnSource( s, darks( 20 ) ), { kind: "map", path: "/maps/rtn.xisf" } );
} );

test( "rtnSource uses the individual WBPP darks when there are enough", () =>
{
   const source = wbpp.anrWbppRtnSource( wbpp.ANR_WBPP_DEFAULT_SETTINGS, darks( 8 ) );
   assert.equal( source.kind, "darks" );
   assert.equal( source.files.length, 8 );
} );

test( "rtnSource reports why RTN mapping is skipped", () =>
{
   const d = wbpp.ANR_WBPP_DEFAULT_SETTINGS;
   assert.match( wbpp.anrWbppRtnSource( d, darks( 3 ) ).reason, /3/ );
   assert.match( wbpp.anrWbppRtnSource( d, [] ).reason, /dark/i );
   assert.equal( wbpp.anrWbppRtnSource( { ...d, rtnEnabled: false }, darks( 20 ) ).kind, "none" );
   assert.equal( wbpp.anrWbppRtnSource( { ...d, rtnUseWbppDarks: false }, darks( 20 ) ).kind, "none" );
} );

test( "stageAFields maps settings, frames and the RTN source", () =>
{
   const s = { ...wbpp.ANR_WBPP_DEFAULT_SETTINGS, coolSigma: 4, cfaMode: "bayer" };
   const f = wbpp.anrWbppStageAFields( s, [ "/c/a.xisf", "/c/b.xisf" ], { kind: "darks", files: darks( 9 ) }, "/out/anr/L", false );

   assert.deepEqual( f.lightFiles, [ "/c/a.xisf", "/c/b.xisf" ] );
   assert.equal( f.rtnEnabled, true );
   assert.equal( f.darkFiles.length, 9 );
   assert.equal( f.rtnDefectMapPath, "" );
   assert.equal( f.coolEnabled, true );
   assert.equal( f.coolSigma, 4 );
   assert.equal( f.cfaMode, wbpp.ANR_WBPP_CFA_MODES.bayer );
   assert.equal( f.outputDir, "/out/anr/L" );
   assert.equal( f.outputSuffix, "_anr" );
   assert.equal( f.overwrite, true );
} );

test( "stageAFields in auto CFA mode follows the WBPP group's CFA flag", () =>
{
   const none = { kind: "none", reason: "x" };
   const d = wbpp.ANR_WBPP_DEFAULT_SETTINGS;
   assert.equal( wbpp.anrWbppStageAFields( d, [ "/a", "/b" ], none, "/o", true ).cfaMode, wbpp.ANR_WBPP_CFA_MODES.bayer );
   assert.equal( wbpp.anrWbppStageAFields( d, [ "/a", "/b" ], none, "/o", false ).cfaMode, wbpp.ANR_WBPP_CFA_MODES.mono );
} );

test( "stageAFields disables the cool file for a single frame and RTN without a source", () =>
{
   const f = wbpp.anrWbppStageAFields( wbpp.ANR_WBPP_DEFAULT_SETTINGS, [ "/c/a.xisf" ], { kind: "none", reason: "x" }, "/o", true );
   assert.equal( f.coolEnabled, false );
   assert.equal( f.rtnEnabled, false );
   assert.equal( wbpp.anrWbppHasWork( f ), false );
} );

// ---------------------------------------------------------------------------
// generated builder
// ---------------------------------------------------------------------------

test( "the generated WBPP builder is up to date with the sources", () =>
{
   const root = path.join( __dirname, ".." );
   const onDisk = fs.readFileSync( path.join( root, BUILDER_FILE ), "utf8" );
   assert.equal( onDisk, buildWbppBuilder( root ), "run: node tools/build-wbpp-builder.js" );
} );

// ---------------------------------------------------------------------------
// FlatSmooth
// ---------------------------------------------------------------------------

const fsw = require( "../ApranatNR-WBPP-FlatSmooth.js" );
const fsCore = require( "../../FlatSmooth/FlatSmooth-Core.js" );

test( "parseSettings validates the FlatSmooth keys", () =>
{
   assert.equal( wbpp.anrWbppParseSettings( "{ \"flatSmoothRadius\": 8 }" ).flatSmoothRadius, 8 );
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"flatSmoothRadius\": 2.5 }" ), /flatSmoothRadius.*whole/ );
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"flatSmoothRadius\": 33 }" ), /flatSmoothRadius/ );
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"flatSmoothTargetPercent\": 0 }" ), /flatSmoothTargetPercent/ );
   assert.throws( () => wbpp.anrWbppParseSettings( "{ \"flatSmoothEnabled\": \"yes\" }" ), /flatSmoothEnabled/ );
} );

test( "the FlatSmooth radius limit matches FlatSmooth-Core.js", () =>
{
   assert.equal( fsw.ANR_WBPP_FS_MAX_RADIUS, fsCore.FS_MAX_RADIUS );
} );

test( "flatSmoothCfa follows the WBPP flat group in auto mode and the setting otherwise", () =>
{
   assert.equal( fsw.anrWbppFlatSmoothCfa( "auto", true ), "on" );
   assert.equal( fsw.anrWbppFlatSmoothCfa( "auto", false ), "off" );
   assert.equal( fsw.anrWbppFlatSmoothCfa( "mono", true ), "off" );
   assert.equal( fsw.anrWbppFlatSmoothCfa( "bayer", false ), "on" );
} );

test( "flatSmoothOutputPath puts <name>_smooth.xisf in the output folder", () =>
{
   assert.equal( fsw.anrWbppFlatSmoothOutputPath( "/out/flatsmooth", "/out/master/masterFlat_BIN-1_FILTER-L_CFA.xisf" ),
                 "/out/flatsmooth/masterFlat_BIN-1_FILTER-L_CFA_smooth.xisf" );
   assert.equal( fsw.anrWbppFlatSmoothOutputPath( "C:/o", "C:\\data\\flat.v2.xisf" ), "C:/o/flat.v2_smooth.xisf" );
} );

test( "flatSmoothFields maps automatic and fixed radius settings", () =>
{
   const d = wbpp.ANR_WBPP_DEFAULT_SETTINGS;
   const auto = fsw.anrWbppFlatSmoothFields( d, "/m/flat.xisf", "/o", true );
   assert.deepEqual( auto, { inputPath: "/m/flat.xisf", outputPath: "/o/flat_smooth.xisf", cfaMode: "on",
                             autoRadius: true, targetPercent: 0.3, fixedRadius: 1, openResult: false } );
   const fixed = fsw.anrWbppFlatSmoothFields( { ...d, flatSmoothRadius: 6 }, "/m/flat.xisf", "/o", false );
   assert.equal( fixed.autoRadius, false );
   assert.equal( fixed.fixedRadius, 6 );
   assert.equal( fixed.cfaMode, "off" );
} );

test( "flatGroupsFor lists each used flat once, skipping lights without a flat", () =>
{
   const flatOf = { L1: "F1", L2: "F2", L3: "F1", L4: null };
   assert.deepEqual( fsw.anrWbppFlatGroupsFor( [ "L1", "L2", "L3", "L4" ], g => flatOf[ g ] ), [ "F1", "F2" ] );
} );

test( "withFilePath swaps the path only while the function runs, also on an error", () =>
{
   const item = { filePath: "/m/flat.xisf" };
   assert.equal( fsw.anrWbppWithFilePath( item, "/o/flat_smooth.xisf", () => item.filePath ), "/o/flat_smooth.xisf" );
   assert.equal( item.filePath, "/m/flat.xisf" );
   assert.throws( () => fsw.anrWbppWithFilePath( item, "/x", () => { throw new Error( "boom" ); } ), /boom/ );
   assert.equal( item.filePath, "/m/flat.xisf" );
} );
