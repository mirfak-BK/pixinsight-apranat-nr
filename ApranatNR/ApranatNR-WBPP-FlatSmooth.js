// ----------------------------------------------------------------------------
// ApranatNR-WBPP-FlatSmooth.js - runs FlatSmooth (../FlatSmooth) inside the
// ApranatNR WBPP pipeline builder.
//
// For every master flat used by a light group, one "FlatSmooth" step is queued
// after the flat pipeline and before the light calibration. It smooths the
// master flat into <output>/flatsmooth/<name>_smooth.xisf (a quiet flat is left
// alone in automatic mode). The light calibration steps that use that flat are
// wrapped so that, while each one runs, the flat group's master file points to
// the smoothed copy; the original path is restored right after, even on an
// error, so the WBPP file list and its saved settings never change.
// The pure helpers at the top are unit tested in Node; the rest needs the WBPP
// runtime and FlatSmooth-Core.js / FlatSmooth-Engine.js (bundled in the builder).
// ----------------------------------------------------------------------------

const ANR_WBPP_FS_SUBDIR = "flatsmooth";
const ANR_WBPP_FS_STEP_NAME = "FlatSmooth";
const ANR_WBPP_FS_MAX_RADIUS = 32;   // must match FS_MAX_RADIUS in FlatSmooth-Core.js

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** FlatSmooth CFA mode ("on" / "off") for a flat group, from the shared cfaMode setting. */
function anrWbppFlatSmoothCfa( cfaMode, isCFA )
{
   if ( cfaMode === "bayer" )
      return "on";
   if ( cfaMode === "mono" )
      return "off";
   return isCFA ? "on" : "off";
}

/** Output path of the smoothed copy of a master flat. */
function anrWbppFlatSmoothOutputPath( outputDir, masterPath )
{
   const slash = Math.max( masterPath.lastIndexOf( "/" ), masterPath.lastIndexOf( "\\" ) );
   const fileName = masterPath.substring( slash + 1 );
   const dot = fileName.lastIndexOf( "." );
   const name = ( dot > 0 ) ? fileName.substring( 0, dot ) : fileName;
   return outputDir + "/" + name + "_smooth.xisf";
}

/**
 * Field values for FsParameters (FlatSmooth-Engine.js) of one master flat.
 */
function anrWbppFlatSmoothFields( settings, masterPath, outputDir, isCFA )
{
   const isAuto = settings.flatSmoothRadius === 0;
   return {
      inputPath: masterPath,
      outputPath: anrWbppFlatSmoothOutputPath( outputDir, masterPath ),
      cfaMode: anrWbppFlatSmoothCfa( settings.cfaMode, isCFA ),
      autoRadius: isAuto,
      targetPercent: settings.flatSmoothTargetPercent,
      fixedRadius: isAuto ? 1 : settings.flatSmoothRadius,
      openResult: false
   };
}

/**
 * The distinct flat groups used by the given light groups, in order.
 * @param {Array} lightGroups
 * @param {(group: any) => any} flatGroupOf the flat group a light group is calibrated with, or null
 */
function anrWbppFlatGroupsFor( lightGroups, flatGroupOf )
{
   const result = [];
   lightGroups.forEach( g =>
   {
      const flat = flatGroupOf( g );
      if ( flat != null && result.indexOf( flat ) < 0 )
         result.push( flat );
   } );
   return result;
}

/**
 * Runs fn() while fileItem.filePath is `path`, then restores the original
 * path, also when fn() throws. WBPP reads the master flat path from the flat
 * group's first file item while it calibrates, and offers no other way to
 * give it a different flat for one run.
 */
function anrWbppWithFilePath( fileItem, path, fn )
{
   const original = fileItem.filePath;
   fileItem.filePath = path;
   try
   {
      return fn();
   }
   finally
   {
      fileItem.filePath = original;
   }
}

// ---------------------------------------------------------------------------
// WBPP runtime glue (needs the WBPP globals and FlatSmooth-Engine.js)
// ---------------------------------------------------------------------------

function anrWbppFlatSmoothCheckConstants()
{
   if ( ANR_WBPP_FS_MAX_RADIUS !== FS_MAX_RADIUS )
      throw new Error( "ApranatNR: internal constant mismatch between ApranatNR-WBPP-FlatSmooth.js and FlatSmooth-Core.js" );
}

/** The flat group WBPP calibrates a light group with, or null (none, or flat disabled). */
function anrWbppFlatGroupOf( engine, lightGroup )
{
   if ( lightGroup.forceNoFlat )
      return null;
   const cg = engine.calibrationMatcher.getCalibrationGroupsFor( lightGroup );
   return ( cg && cg.masterFlat ) ? cg.masterFlat : null;
}

function anrWbppMasterItem( flatGroup )
{
   const item = flatGroup.hasMaster ? flatGroup.fileItems[ 0 ] : undefined;
   return ( item && item.isMaster && typeof item.filePath === "string" && item.filePath.length > 0 ) ? item : null;
}

function anrWbppRunFlatSmooth( engine, flatGroup, settings, smoothed, op, requestInterruption )
{
   const item = anrWbppMasterItem( flatGroup );
   if ( item === null )
   {
      // WBPP itself stops the calibration of the lights that need a missing master
      anrWbppWarn( engine, op, "FlatSmooth skipped: the master flat of this group is not available." );
      op.statusMessage = "no master flat";
      return OperationBlockStatus.CANCELED;
   }
   try
   {
      const outputDir = anrEnsureDirectory( engine.outputDirectory + "/" + ANR_WBPP_FS_SUBDIR );
      const p = Object.assign( new FsParameters, anrWbppFlatSmoothFields( settings, item.filePath, outputDir, flatGroup.isCFA ) );
      if ( p.outputPath !== p.inputPath && File.exists( p.outputPath ) )
         File.remove( p.outputPath );   // never calibrate with the copy of a previous run
      const s = fsRun( p, true );
      if ( !s.written )
      {
         op.statusMessage = format( "quiet flat (%.3f%%), not changed", 100 * s.noise );
         engine.processLogger.addSuccess( ANR_WBPP_FS_STEP_NAME, op.statusMessage + ": " + item.filePath );
         return OperationBlockStatus.DONE;
      }
      smoothed.set( flatGroup, s.output );
      op.statusMessage = format( "radius %d, pixel noise %.3f%% -> %.4f%%", s.radius, 100 * s.noise, 100 * s.residual );
      engine.processLogger.addSuccess( ANR_WBPP_FS_STEP_NAME, op.statusMessage + " -> " + s.output );
      return OperationBlockStatus.DONE;
   }
   catch ( x )
   {
      // calibrating with the unsmoothed flat would give a result the user did not ask for
      const message = "FlatSmooth failed on " + item.filePath + ": " + ( ( x instanceof Error ) ? x.message : String( x ) );
      console.criticalln( "<end><cbr>*** Error: " + message );
      engine.processLogger.addError( message );
      op.statusMessage = "failed";
      requestInterruption();
      return OperationBlockStatus.FAILED;
   }
}

/** Makes a light calibration step use the smoothed master flat while it runs. */
function anrWbppUseSmoothedFlat( engine, calibration, smoothed )
{
   const run = calibration._run;
   calibration._run = ( env, requestInterruption ) =>
   {
      const flatGroup = anrWbppFlatGroupOf( engine, calibration.group );
      const path = flatGroup ? smoothed.get( flatGroup ) : undefined;
      const item = flatGroup ? anrWbppMasterItem( flatGroup ) : null;
      if ( path === undefined || item === null )
         return run( env, requestInterruption );
      console.noteln( "<end><cbr>* FlatSmooth: calibrating with <raw>" + path + "</raw>" );
      return anrWbppWithFilePath( item, path, () => run( env, requestInterruption ) );
   };
}

/**
 * The FlatSmooth steps to queue before the light calibration, and the
 * wrapping of the light calibration entries. Returns [] when disabled.
 * @param {Array} lightEntries queue entries of the light pipeline
 * @param {(entry: any) => any} calibratedGroupOf the light group an entry calibrates, or null
 */
function anrWbppFlatSmoothEntries( engine, settings, lightEntries, calibratedGroupOf )
{
   if ( !settings.flatSmoothEnabled )
      return [];
   anrWbppFlatSmoothCheckConstants();
   const lightGroups = engine.groupsManager.groupsForMode( BPP.GroupingMode.PRE ).filter( g => g.imageType == ImageType.Light );
   const flats = anrWbppFlatGroupsFor( lightGroups, g => anrWbppFlatGroupOf( engine, g ) );
   if ( flats.length === 0 )
      return [];
   const smoothed = new Map();   // flat group -> smoothed master path, filled at run time
   lightEntries.filter( e => calibratedGroupOf( e ) != null )
               .forEach( e => anrWbppUseSmoothedFlat( engine, e.operation, smoothed ) );
   return flats.map( flat => anrWbppEntry( anrWbppOperation( ANR_WBPP_FS_STEP_NAME, flat,
      ( op, requestInterruption ) => anrWbppRunFlatSmooth( engine, flat, settings, smoothed, op, requestInterruption ) ) ) );
}

if ( typeof module !== "undefined" && module.exports )
   module.exports = {
      ANR_WBPP_FS_MAX_RADIUS,
      anrWbppFlatSmoothCfa,
      anrWbppFlatSmoothOutputPath,
      anrWbppFlatSmoothFields,
      anrWbppFlatGroupsFor,
      anrWbppWithFilePath
   };
