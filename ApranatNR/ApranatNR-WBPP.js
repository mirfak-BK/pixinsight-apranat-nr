// ----------------------------------------------------------------------------
// ApranatNR-WBPP.js - runs ApranatNR inside WBPP as a pipeline builder.
//
// WBPP (3.2+) lets a "pipeline builder" script assemble the light pipeline.
// This module builds the standard WBPP light pipeline and inserts:
//   - optionally, one "FlatSmooth" step per master flat used by the lights,
//     before the light calibration (see ApranatNR-WBPP-FlatSmooth.js)
//   - one "ApranatNR" step per light group, right after its calibration
//     (before cosmetic correction / debayering): RTN pixel mapping + cool file
//   - optionally, after the integration, one "ApranatNR Cosmicut" step per
//     integration group, writing an extra master next to the WBPP master.
// WBPP itself is not modified. The pure helpers at the top are unit tested in
// Node; the functions below them need the WBPP runtime and are only called
// from anrWbppBuilderMain().
// ----------------------------------------------------------------------------

// Must match ANR_CFA_*, ANR_MIN_DARK_FRAMES and ANR_MIN_COOL_FRAMES in
// ApranatNR-Engine.js (checked at run time by anrWbppCheckConstants()).
const ANR_WBPP_CFA_MODES = Object.freeze( { auto: 0, mono: 1, bayer: 2 } );
const ANR_WBPP_MIN_RTN_DARKS = 8;
const ANR_WBPP_MIN_COOL_FRAMES = 2;
const ANR_WBPP_MIN_COSMICUT_FRAMES = 3;

const ANR_WBPP_SUBDIR = "apranatnr";
const ANR_WBPP_SUFFIX = "_anr";
const ANR_WBPP_SETTINGS_FILE = "ApranatNR-WBPP-Settings.json";
const ANR_WBPP_STEP_NAME = "ApranatNR";
const ANR_WBPP_COSMICUT_STEP_NAME = "ApranatNR Cosmicut";

const ANR_WBPP_DEFAULT_SETTINGS = Object.freeze( {
   rtnEnabled: true,
   rtnDefectMapPath: "",
   rtnUseWbppDarks: true,
   rtnRatio: 4.0,
   rtnProtectStructures: true,
   coolEnabled: true,
   coolSigma: 5.0,
   coolProtectStructures: true,
   cfaMode: "auto",
   cosmicutEnabled: false,
   cosmicutExcludeZero: true,
   flatSmoothEnabled: true,
   flatSmoothRadius: 0,
   flatSmoothTargetPercent: 0.3
} );

const ANR_WBPP_SETTINGS_SCHEMA = Object.freeze( {
   rtnEnabled: { type: "boolean" },
   rtnDefectMapPath: { type: "string" },
   rtnUseWbppDarks: { type: "boolean" },
   rtnRatio: { type: "number", min: 1.5, max: 20 },
   rtnProtectStructures: { type: "boolean" },
   coolEnabled: { type: "boolean" },
   coolSigma: { type: "number", min: 0, max: 10 },
   coolProtectStructures: { type: "boolean" },
   cfaMode: { type: "string", values: Object.keys( ANR_WBPP_CFA_MODES ) },
   cosmicutEnabled: { type: "boolean" },
   cosmicutExcludeZero: { type: "boolean" },
   flatSmoothEnabled: { type: "boolean" },
   flatSmoothRadius: { type: "number", min: 0, max: 32, integer: true },   // 0 = automatic
   flatSmoothTargetPercent: { type: "number", min: 0.01, max: 10 }
} );

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function anrWbppCheckValue( key, value, rule )
{
   if ( typeof value !== rule.type )
      return "\"" + key + "\" must be a " + rule.type;
   if ( rule.type === "number" && !( Number.isFinite( value ) && value >= rule.min && value <= rule.max ) )
      return "\"" + key + "\" must be between " + rule.min + " and " + rule.max;
   if ( rule.integer && !Number.isInteger( value ) )
      return "\"" + key + "\" must be a whole number";
   if ( rule.values && rule.values.indexOf( value ) < 0 )
      return "\"" + key + "\" must be one of " + rule.values.map( v => "\"" + v + "\"" ).join( ", " );
   return null;
}

/**
 * Parses the settings file: JSON, where whole lines starting with // are
 * comments. Unknown keys, wrong types and out-of-range values are errors;
 * missing keys take their default value.
 * @returns {object} a new settings object
 */
function anrWbppParseSettings( text )
{
   const json = String( text ).replace( /^﻿/, "" )   // byte order mark (e.g. Windows Notepad)
                              .split( /\r?\n/ ).filter( line => !/^\s*\/\//.test( line ) ).join( "\n" );
   let raw;
   try
   {
      raw = JSON.parse( json );
   }
   catch ( x )
   {
      throw new Error( "ApranatNR WBPP settings: invalid JSON (" + x.message + ")" );
   }
   if ( raw === null || typeof raw !== "object" || Array.isArray( raw ) )
      throw new Error( "ApranatNR WBPP settings: the file must contain a JSON object" );

   const problems = Object.keys( raw ).map( key =>
      ANR_WBPP_SETTINGS_SCHEMA.hasOwnProperty( key )
         ? anrWbppCheckValue( key, raw[ key ], ANR_WBPP_SETTINGS_SCHEMA[ key ] )
         : "unknown key \"" + key + "\"" ).filter( p => p !== null );
   if ( problems.length > 0 )
      throw new Error( "ApranatNR WBPP settings: " + problems.join( "; " ) );
   return Object.assign( {}, ANR_WBPP_DEFAULT_SETTINGS, raw );
}

/**
 * Returns a new entry list with one addition per group: right after the entry
 * that calibrates that group (searched from `start`, the first light-pipeline
 * entry), or at `start` for groups that are not calibrated in this run.
 * @param {Array} entries queue entries (not modified)
 * @param {number} start
 * @param {(entry: any) => any} calibratedGroupOf the group an entry calibrates, or null
 * @param {Array<{group: any, entry: any}>} additions
 */
function anrWbppInsertAfterCalibration( entries, start, calibratedGroupOf, additions )
{
   const byGroup = new Map( additions.map( a => [ a.group, a.entry ] ) );
   const calibrated = new Set();
   for ( let i = start; i < entries.length; ++i )
   {
      const g = calibratedGroupOf( entries[ i ] );
      if ( g != null && byGroup.has( g ) )
         calibrated.add( g );
   }
   const result = entries.slice( 0, start ).concat(
      additions.filter( a => !calibrated.has( a.group ) ).map( a => a.entry ) );
   for ( let i = start; i < entries.length; ++i )
   {
      result.push( entries[ i ] );
      const g = calibratedGroupOf( entries[ i ] );
      if ( g != null && calibrated.has( g ) )
      {
         result.push( byGroup.get( g ) );
         calibrated.delete( g );
      }
   }
   return result;
}

/**
 * Where the RTN defect map comes from: an explicit map file, the individual
 * dark frames WBPP matched to the light group, or nowhere (with the reason).
 */
function anrWbppRtnSource( settings, darkFiles )
{
   if ( !settings.rtnEnabled )
      return { kind: "none", reason: "RTN pixel mapping is disabled in the settings" };
   if ( settings.rtnDefectMapPath.length > 0 )
      return { kind: "map", path: settings.rtnDefectMapPath };
   if ( !settings.rtnUseWbppDarks )
      return { kind: "none", reason: "no defect map is set and the use of the WBPP darks is disabled" };
   if ( darkFiles.length === 0 )
      return { kind: "none", reason: "no individual dark frames are matched to this group (a master dark cannot be used)" };
   if ( darkFiles.length < ANR_WBPP_MIN_RTN_DARKS )
      return { kind: "none", reason: "only " + darkFiles.length + " individual dark frames are matched to this group (" +
                                      ANR_WBPP_MIN_RTN_DARKS + " needed)" };
   return { kind: "darks", files: darkFiles.slice() };
}

/**
 * Field values for AnrParameters (stage A) of one light group.
 */
function anrWbppStageAFields( settings, lightFiles, rtnSource, outputDir, isCFA )
{
   const cfaMode = ( settings.cfaMode === "auto" )
      ? ( isCFA ? ANR_WBPP_CFA_MODES.bayer : ANR_WBPP_CFA_MODES.mono )
      : ANR_WBPP_CFA_MODES[ settings.cfaMode ];
   return {
      lightFiles: lightFiles.slice(),
      cfaMode: cfaMode,
      rtnEnabled: rtnSource.kind !== "none",
      rtnDefectMapPath: ( rtnSource.kind === "map" ) ? rtnSource.path : "",
      darkFiles: ( rtnSource.kind === "darks" ) ? rtnSource.files.slice() : [],
      rtnRatio: settings.rtnRatio,
      rtnProtectStructures: settings.rtnProtectStructures,
      coolEnabled: settings.coolEnabled && lightFiles.length >= ANR_WBPP_MIN_COOL_FRAMES,
      coolSigma: settings.coolSigma,
      coolProtectStructures: settings.coolProtectStructures,
      outputDir: outputDir,
      outputSuffix: ANR_WBPP_SUFFIX,
      overwrite: true
   };
}

function anrWbppHasWork( fields )
{
   return fields.rtnEnabled || fields.coolEnabled;
}

// ---------------------------------------------------------------------------
// WBPP runtime glue (needs the WBPP globals: engine, BPPOperationBlock, BPP,
// ImageType, OperationBlockStatus)
// ---------------------------------------------------------------------------

function anrWbppCheckConstants()
{
   if ( ANR_WBPP_CFA_MODES.auto !== ANR_CFA_AUTO || ANR_WBPP_CFA_MODES.mono !== ANR_CFA_MONO ||
        ANR_WBPP_CFA_MODES.bayer !== ANR_CFA_BAYER || ANR_WBPP_MIN_RTN_DARKS !== ANR_MIN_DARK_FRAMES ||
        ANR_WBPP_MIN_COOL_FRAMES !== ANR_MIN_COOL_FRAMES || ANR_WBPP_MIN_COSMICUT_FRAMES !== ANR_MIN_COSMICUT_FRAMES )
      throw new Error( "ApranatNR: internal constant mismatch between ApranatNR-WBPP.js and ApranatNR-Engine.js" );
}

function anrWbppSettingsPath( builderPath )
{
   return File.extractDrive( builderPath ) + File.extractDirectory( builderPath ) + "/" + ANR_WBPP_SETTINGS_FILE;
}

/**
 * Individual dark frames of the dark group WBPP matched to a light group,
 * without the frames WBPP has excluded. Once WBPP has integrated the master
 * dark it adds the master to the same group (hasMaster becomes true), so
 * master files are skipped, not the whole group.
 */
function anrWbppDarkFilesFor( engine, group )
{
   const cg = engine.calibrationMatcher.getCalibrationGroupsFor( group );
   const darkGroup = cg ? cg.masterDark : undefined;
   if ( !darkGroup )
      return [];
   return darkGroup.activeFrames().map( f => f.fileItem ).filter( item => !item.isMaster )
                   .map( item => item.filePath ).filter( p => typeof p === "string" && p.length > 0 );
}

function anrWbppRegisteredPath( frame )
{
   const processed = frame.fileItem && frame.fileItem.processed ? frame.fileItem.processed[ frame.associatedID ] : undefined;
   const filePath = processed ? processed[ BPP.FrameProcessingStep.REGISTRATION ] : undefined;
   return ( typeof filePath === "string" && filePath.length > 0 && File.exists( filePath ) ) ? filePath : null;
}

function anrWbppWarn( engine, op, text )
{
   console.warningln( "<end><cbr>** Warning: " + text );
   engine.processLogger.addWarning( text );
   op.hasWarnings = true;
}

function anrWbppOperation( name, group, run )
{
   const op = new BPPOperationBlock( name, group, true /*trackable*/ );
   op.envForScript = () => ( { name: name, status: op.status, statusMessage: op.statusMessage, group: group } );
   op._run = ( env, requestInterruption ) => run( op, requestInterruption );
   return op;
}

function anrWbppRunStageA( engine, group, settings, op )
{
   const frames = group.activeFrames();
   if ( frames.length === 0 )
   {
      op.statusMessage = "no active frames";
      return OperationBlockStatus.DONE;
   }
   const source = anrWbppRtnSource( settings, anrWbppDarkFilesFor( engine, group ) );
   if ( source.kind === "none" && settings.rtnEnabled )
      anrWbppWarn( engine, op, "ApranatNR: RTN pixel mapping skipped: " + source.reason + "." );
   const outputDir = engine.outputDirectory + "/" + ANR_WBPP_SUBDIR + "/" + group.folderName();
   const fields = anrWbppStageAFields( settings, frames.map( f => f.current ), source, outputDir, group.isCFA );
   if ( settings.coolEnabled && !fields.coolEnabled )
      anrWbppWarn( engine, op, format( "ApranatNR: cool file skipped: %d frame(s) in this group (%d needed).",
                                       frames.length, ANR_WBPP_MIN_COOL_FRAMES ) );
   if ( !anrWbppHasWork( fields ) )
   {
      op.statusMessage = "nothing to do";
      return OperationBlockStatus.DONE;
   }

   const outputs = anrRunStageA( Object.assign( new AnrParameters, fields ) );
   if ( outputs.length !== frames.length )
      throw new Error( format( "ApranatNR wrote %d frames for %d inputs", outputs.length, frames.length ) );
   frames.forEach( ( frame, i ) => frame.processingSucceeded( BPP.FrameProcessingStep.CALIBRATION, outputs[ i ] ) );

   const what = [ fields.rtnEnabled ? ( source.kind === "map" ? "RTN map" : "RTN from " + source.files.length + " darks" ) : "",
                  fields.coolEnabled ? "cool file" : "" ].filter( s => s.length > 0 ).join( " + " );
   op.statusMessage = format( "%d frames (%s)", outputs.length, what );
   engine.processLogger.addSuccess( ANR_WBPP_STEP_NAME, op.statusMessage + " -> " + outputDir );
   return OperationBlockStatus.DONE;
}

function anrWbppRunCosmicut( engine, group, settings, op )
{
   const files = group.activeFrames().filter( f => !f.__fastIntegration ).map( anrWbppRegisteredPath ).filter( p => p !== null );
   if ( files.length < ANR_WBPP_MIN_COSMICUT_FRAMES )
   {
      anrWbppWarn( engine, op, format( "ApranatNR Cosmicut skipped: %d registered frames (%d needed).", files.length, ANR_WBPP_MIN_COSMICUT_FRAMES ) );
      op.statusMessage = "skipped";
      return OperationBlockStatus.CANCELED;
   }
   const p = Object.assign( new AnrParameters, {
      registeredFiles: files,
      cosmicutExcludeZero: settings.cosmicutExcludeZero,
      cosmicutOutputDir: engine.outputDirectory + "/master",
      cosmicutMasterName: "master" + group.folderName() + "_cosmicut",
      overwrite: true
   } );
   const masterPath = anrRunStageB( p );
   op.statusMessage = format( "%d frames", files.length );
   engine.processLogger.addSuccess( ANR_WBPP_COSMICUT_STEP_NAME, masterPath );
   return OperationBlockStatus.DONE;
}

function anrWbppErrorOperation( engine, message )
{
   return anrWbppOperation( ANR_WBPP_STEP_NAME, undefined, ( op, requestInterruption ) =>
   {
      console.criticalln( "<end><cbr>*** Error: " + message );
      engine.processLogger.addError( message );
      op.statusMessage = message;
      requestInterruption();
      return OperationBlockStatus.FAILED;
   } );
}

function anrWbppReplaceQueue( queue, entries )
{
   queue.operations.splice( 0, queue.operations.length, ...entries );
   queue.operations.forEach( ( e, i ) => { e.operation.__index__ = i; } );
}

function anrWbppEntry( operation )
{
   return { operation: operation, params: undefined };
}

function anrWbppStageAEntry( engine, group, settings )
{
   const op = anrWbppOperation( ANR_WBPP_STEP_NAME, group, ( self ) => anrWbppRunStageA( engine, group, settings, self ) );
   op.failsFramesOnError = true;
   op.spaceRequired = () => group.groupSize();
   // the corrected frames are one more copy of the calibrated lights
   if ( engine.WS && engine.WS.calibrationLight )
      engine.WS.calibrationLight.size += op.spaceRequired();
   return anrWbppEntry( op );
}

function anrWbppCosmicutEntries( engine, settings )
{
   if ( !settings.cosmicutEnabled )
      return [];
   if ( !engine.imageRegistration )
   {
      // no console output here: the builder runs on every GUI interaction
      const message = "ApranatNR Cosmicut needs image registration, which is disabled: no Cosmicut master will be written.";
      engine.pipelineBuilderWarning = message;
      return [ anrWbppEntry( anrWbppOperation( ANR_WBPP_COSMICUT_STEP_NAME, undefined, ( op ) =>
      {
         anrWbppWarn( engine, op, message );
         op.statusMessage = "skipped";
         return OperationBlockStatus.CANCELED;
      } ) ) ];
   }
   return engine.groupsManager.groupsForMode( BPP.GroupingMode.POST )
      .filter( g => g.isActive && g.imageType == ImageType.Light )
      .map( g => anrWbppEntry( anrWbppOperation( ANR_WBPP_COSMICUT_STEP_NAME, g,
                                                 ( self ) => anrWbppRunCosmicut( engine, g, settings, self ) ) ) );
}

function anrWbppAddSteps( engine, settings, start )
{
   const queue = engine.operationQueue;
   const additions = engine.groupsManager.groupsForMode( BPP.GroupingMode.PRE )
      .filter( g => g.imageType == ImageType.Light )
      .map( g => ( { group: g, entry: anrWbppStageAEntry( engine, g, settings ) } ) );
   const calibratedGroupOf = e =>
      ( e.operation instanceof engine.calibrationOperation && e.operation.group && e.operation.group.imageType == ImageType.Light )
         ? e.operation.group : null;
   const withAnr = anrWbppInsertAfterCalibration( queue.operations, start, calibratedGroupOf, additions );
   // FlatSmooth runs after all master flats exist and before any light calibration
   const flatSmooth = anrWbppFlatSmoothEntries( engine, settings, withAnr.slice( start ), calibratedGroupOf );
   const entries = withAnr.slice( 0, start ).concat( flatSmooth, withAnr.slice( start ), anrWbppCosmicutEntries( engine, settings ) );
   anrWbppReplaceQueue( queue, entries );
}

/**
 * Builds the standard WBPP light pipeline plus the ApranatNR steps. A settings
 * problem does not silently fall back to plain WBPP: it is shown in the
 * pipeline panel and queued as a failing step that stops the run before the
 * lights are processed.
 */
function anrWbppBuild( engine, settingsText, settingsPath )
{
   const queue = engine.operationQueue;
   const start = queue.operations.length;
   try
   {
      engine.pipelineManager.buildPipelineForLight();
   }
   catch ( x )
   {
      // leave the queue as it was, so that WBPP's own fallback starts clean
      queue.operations.splice( start );
      throw x;
   }

   try
   {
      anrWbppCheckConstants();
      if ( settingsText === null )
         throw new Error( "ApranatNR WBPP settings file not found: " + settingsPath );
      anrWbppAddSteps( engine, anrWbppParseSettings( settingsText ), start );
   }
   catch ( x )
   {
      const message = ( x instanceof Error ) ? x.message : String( x );
      engine.pipelineBuilderWarning = message;
      anrWbppReplaceQueue( queue, queue.operations.slice( 0, start )
         .concat( [ anrWbppEntry( anrWbppErrorOperation( engine, message ) ) ], queue.operations.slice( start ) ) );
   }
}

function anrWbppBuilderMain( engine )
{
   const settingsPath = anrWbppSettingsPath( engine.pipelineBuilderScriptFile );
   const settingsText = File.exists( settingsPath ) ? File.readTextFile( settingsPath ) : null;
   anrWbppBuild( engine, settingsText, settingsPath );
}

if ( typeof module !== "undefined" && module.exports )
   module.exports = {
      ANR_WBPP_CFA_MODES,
      ANR_WBPP_DEFAULT_SETTINGS,
      anrWbppParseSettings,
      anrWbppInsertAfterCalibration,
      anrWbppRtnSource,
      anrWbppStageAFields,
      anrWbppHasWork
   };
