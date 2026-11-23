// ----------------------------------------------------------------------------
// ApranatNR-Engine.js - processing pipeline
//
// Stage A (calibrated, NOT registered frames):
//    [RTN "drunk" pixel mapping] -> [cool file correction] -> corrected frames
// Stage B (registered frames):
//    Cosmicut composite = (sum - max) / (n - 1)
// ----------------------------------------------------------------------------

const ANR_CFA_AUTO = 0;
const ANR_CFA_MONO = 1;
const ANR_CFA_BAYER = 2;

const ANR_MIN_COOL_FRAMES = 2;
const ANR_RECOMMENDED_COOL_FRAMES = 10;
const ANR_MIN_DARK_FRAMES = 8;
const ANR_MIN_COSMICUT_FRAMES = 3;
const ANR_DEFAULT_SUBDIR = "ApranatNR";
// broken darks (saturated, clipped) flag far more; real RTN maps reach about
// 1.2% at high gain (ASI533MC Pro, Gain 400-460)
const ANR_MAX_DEFECT_FRACTION = 0.03;
const ANR_CFA_IMBALANCE_WARNING = 1.15;
// stars cover well under 1% of the map; far more kept pixels means the RTN
// pixels' mean differs between the darks and the lights
const ANR_STACK_KEEP_WARNING = 0.05;

class AnrParameters
{
   lightFiles = [];
   darkFiles = [];
   registeredFiles = [];

   cfaMode = ANR_CFA_AUTO;

   rtnEnabled = false;
   rtnDefectMapPath = "";
   rtnRatio = 4.0;
   rtnProtectStructures = true;

   coolEnabled = true;
   coolSigma = 5.0;
   coolProtectStructures = true;

   outputDir = "";
   outputSuffix = "_anr";
   overwrite = false;

   cosmicutExcludeZero = true;
   cosmicutSaveMax = false;
   cosmicutOutputDir = "";
   cosmicutMasterName = "master_cosmicut";
   cosmicutMaxName = "cosmicut_rejected_max";
}

function anrHeader( text )
{
   console.noteln( "<end><cbr><br>* " + ANR_TITLE + ": " + text );
}

function anrInfo( text )
{
   console.writeln( "<end><cbr><raw>" + text + "</raw>" );
}

function anrHistory( text )
{
   return ANR_TITLE + " " + ANR_VERSION + ": " + text;
}

function anrGeometryOf( frame )
{
   return { width: frame.width, height: frame.height, channels: frame.planes.length };
}

function anrCheckGeometry( frame, geom )
{
   if ( frame.width !== geom.width || frame.height !== geom.height || frame.planes.length !== geom.channels )
      throw new Error( format( "Image geometry mismatch (%dx%dx%d, expected %dx%dx%d): ",
                               frame.width, frame.height, frame.planes.length,
                               geom.width, geom.height, geom.channels ) + frame.filePath );
}

function anrResolveStep( cfaMode, frame )
{
   if ( cfaMode === ANR_CFA_MONO )
      return 1;
   if ( cfaMode === ANR_CFA_BAYER )
   {
      if ( frame.planes.length !== 1 )
         throw new Error( "Bayer CFA mode requires single-channel (not debayered) frames: " + frame.filePath );
      return 2;
   }
   return anrFrameLooksCfa( frame ) ? 2 : 1;
}

function anrResolveOutputDir( explicitDir, files )
{
   const dir = ( explicitDir.length > 0 ) ? explicitDir : anrDirectoryOf( files[ 0 ] ) + "/" + ANR_DEFAULT_SUBDIR;
   return anrEnsureDirectory( dir );
}

function anrSourceMeta( frame )
{
   return { keywords: frame.keywords, properties: frame.properties, description: frame.description };
}

// ---------------------------------------------------------------------------
// RTN ("drunk") pixel mapping
// ---------------------------------------------------------------------------

function anrValidateDefectCount( count, total, hint )
{
   if ( count > ANR_MAX_DEFECT_FRACTION * total )
      throw new Error( format( "%d defective pixels (%.2f%%) exceed the %.0f%% safety limit; ",
                               count, 100 * count / total, 100 * ANR_MAX_DEFECT_FRACTION ) + hint );
}

function anrLoadDefectMap( filePath, geom )
{
   const frame = anrReadFrame( filePath );
   if ( frame.width !== geom.width || frame.height !== geom.height )
      throw new Error( "Defect map size does not match the light frames: " + filePath );
   const mask = Uint8Array.from( frame.planes[ 0 ], v => ( v > 0.5 ) ? 1 : 0 );
   const count = mask.reduce( ( a, v ) => a + v, 0 );
   anrValidateDefectCount( count, mask.length, "this does not look like an RTN defect map." );
   anrInfo( format( "Defect map loaded: %d defective pixels", count ) );
   return mask;
}

function anrDefectMaskFromDarks( p, geom, outDir )
{
   if ( p.darkFiles.length < ANR_MIN_DARK_FRAMES )
      throw new Error( format( "At least %d individual dark frames are required to detect RTN pixels.", ANR_MIN_DARK_FRAMES ) );

   const stats = new AnrTemporalStats( geom.width * geom.height );
   p.darkFiles.forEach( ( path, i ) =>
   {
      anrCheckAbort();
      anrInfo( format( "Dark %d/%d: ", i + 1, p.darkFiles.length ) + path );
      const dark = anrReadFrame( path );
      if ( dark.width !== geom.width || dark.height !== geom.height || dark.planes.length !== 1 )
         throw new Error( "Dark frame geometry does not match the light frames: " + path );
      stats.add( dark.planes[ 0 ] );
   } );

   const trimmedStd = stats.trimmedStd();
   const detection = anrDetectNoisyPixels( trimmedStd, p.rtnRatio, anrLowerQuartileLevel( stats.trimmedMean(), trimmedStd ) );
   const model = detection.model;
   anrInfo( format( "RTN pixels: %d (%.4f%%), median trimmed temporal sigma = %.3e; " +
                    "criterion: sigma > %.2f x expected sigma at its lower-quartile dark level (max/min sample excluded)",
                    detection.count, 100 * detection.count / detection.mask.length,
                    detection.medianStd, p.rtnRatio ) );
   anrInfo( format( "Expected sigma^2 = %.3e^2 + %.3e x (level - %.5f): read noise + dark-current shot noise, slope from %d warm pixels",
                    model.read, model.slope, model.base, model.warmPixels ) );
   if ( model.slope === 0 )
      console.warningln( "** Warning: too few warm pixels to measure the shot noise: hot pixels may be flagged as RTN pixels." );
   anrValidateDefectCount( detection.count, detection.mask.length,
                           "raise the std-dev ratio threshold or check the dark frames (clipped or quantized data?)." );

   const mapPath = anrOutputPath( outDir, "rtn_defect_map", p.overwrite );
   anrWriteImage( mapPath, [ Float32Array.from( detection.mask ) ], geom.width, geom.height, {},
                  [ anrHistory( format( "RTN defect map from %d darks, ratio %.2f vs read + shot noise model, trimmed", p.darkFiles.length, p.rtnRatio ) ) ] );
   anrInfo( "Defect map written: " + mapPath );
   return detection.mask;
}

function anrBuildDefectMask( p, geom, outDir )
{
   anrHeader( "RTN (drunk) pixel mapping" );
   if ( geom.channels !== 1 )
      throw new Error( "RTN pixel mapping must be applied to single-channel frames before debayering." );
   return ( p.rtnDefectMapPath.length > 0 ) ? anrLoadDefectMap( p.rtnDefectMapPath, geom )
                                            : anrDefectMaskFromDarks( p, geom, outDir );
}

function anrPreparePlanes( frame, geom, step, mask, protectStructures, keep = null )
{
   anrCheckGeometry( frame, geom );
   if ( !mask )
      return { planes: frame.planes, repaired: 0, kept: 0, stackKept: 0 };
   const result = anrRepairDefects( frame.planes[ 0 ], geom.width, geom.height, mask, step, protectStructures, keep );
   return { planes: [ result.data ], repaired: result.repaired, kept: result.protectedCount + result.stackKept, stackKept: result.stackKept };
}

/**
 * One pass over the lights: unregistered stack of the raw calibrated frames
 * (for the stack protection; the brightest sample of each pixel is dropped,
 * so a single cosmic-ray hit does not look like a star) and/or average of the
 * RTN-repaired frames (for the cool file; per-frame protection only, which is
 * enough there because the cool file only concerns pixels darker than their
 * neighbors).
 * @returns {{raw: Float32Array[]|null, repaired: Float32Array[]|null}}
 */
function anrStackLights( p, geom, step, mask, wantRaw, wantRepaired )
{
   anrHeader( "Unregistered average stack" );
   const pixels = geom.width * geom.height;
   const robust = p.lightFiles.length >= 2;
   const raw = wantRaw ? [ robust ? new AnrCosmicutAccumulator( pixels, false ) : new AnrMeanAccumulator( pixels ) ] : null;
   const repaired = wantRepaired ? Array.from( { length: geom.channels }, () => new AnrMeanAccumulator( pixels ) ) : null;
   p.lightFiles.forEach( ( path, i ) =>
   {
      anrCheckAbort();
      anrInfo( format( "Stacking %d/%d: ", i + 1, p.lightFiles.length ) + path );
      const frame = anrReadFrame( path );
      anrCheckGeometry( frame, geom );
      if ( raw )
         raw[ 0 ].add( frame.planes[ 0 ] );
      if ( repaired )
         anrPreparePlanes( frame, geom, step, mask, p.rtnProtectStructures ).planes.forEach( ( plane, c ) => repaired[ c ].add( plane ) );
   } );
   return { raw: raw ? raw.map( a => robust ? a.result() : a.mean() ) : null, repaired: repaired ? repaired.map( a => a.mean() ) : null };
}

function anrStackProtection( rawStack, geom, step, mask )
{
   const result = anrStackStructureMask( rawStack, geom.width, geom.height, step, mask, ANR_STACK_PROTECT_SIGMAS, ANR_STACK_FOOTPRINT_SIGMAS );
   const total = mask.reduce( ( a, v ) => a + v, 0 );
   anrInfo( format( "Stack protection: %d of %d RTN pixels (%.2f%%) left unrepaired because the unregistered stack of the raw frames " +
                    "shows a star on them (own excess > %.0f sigma: %d, footprint of the adjacent pixels > %.0f sigma: %d)",
                    result.count, total, ( total > 0 ) ? 100 * result.count / total : 0,
                    ANR_STACK_PROTECT_SIGMAS, result.ownCount, ANR_STACK_FOOTPRINT_SIGMAS, result.footprintCount ) );
   if ( result.count > ANR_STACK_KEEP_WARNING * total )
      console.warningln( format( "** Warning: %.1f%% of the RTN pixels look bright in the stack of the lights. The darks may not match the lights " +
                                 "(temperature, gain, exposure); those pixels are left as WBPP alone would leave them.", 100 * result.count / total ) );
   return result.keep;
}

// ---------------------------------------------------------------------------
// Cool file
// ---------------------------------------------------------------------------

function anrBuildCoolFiles( p, geom, step, stack, outDir )
{
   anrHeader( "Cool file (unregistered average stack)" );
   if ( p.lightFiles.length < ANR_RECOMMENDED_COOL_FRAMES )
      console.warningln( format( "** Warning: only %d frames; %d or more are recommended for a clean cool file.",
                                 p.lightFiles.length, ANR_RECOMMENDED_COOL_FRAMES ) );
   const pixels = geom.width * geom.height;
   if ( step === 1 && geom.channels === 1 )
   {
      const imbalance = anrCfaPhaseImbalance( stack[ 0 ], geom.width, geom.height );
      if ( imbalance > ANR_CFA_IMBALANCE_WARNING )
         console.warningln( format( "** Warning: the 2x2 pixel phases differ by a factor of %.2f. " +
                                    "If this is undebayered color (CFA) data, select 'Bayer CFA' and run again.", imbalance ) );
   }
   const results = stack.map( plane =>
      anrComputeCoolFile( plane, geom.width, geom.height, step, p.coolSigma, p.coolProtectStructures ) );
   results.forEach( ( r, c ) =>
      anrInfo( format( "Channel %d: %d cool pixels corrected (%.4f%%), %d skipped on structures, residual sigma per CFA phase = ",
                       c, r.correctedCount, 100 * r.correctedCount / pixels, r.protectedCount ) +
               r.sigmas.map( s => s.toExponential( 3 ) ).join( ", " ) ) );

   const history = [ anrHistory( format( "%d frames, threshold %.2f sigma, CFA step %d, structure protection %s",
                                         p.lightFiles.length, p.coolSigma, step, p.coolProtectStructures ? "on" : "off" ) ) ];
   const stackPath = anrOutputPath( outDir, "unregistered_stack", p.overwrite );
   anrWriteImage( stackPath, stack, geom.width, geom.height, {}, history.concat( [ anrHistory( "unregistered average stack" ) ] ) );
   const coolPath = anrOutputPath( outDir, "coolfile", p.overwrite );
   const coolFiles = results.map( r => r.coolFile );
   anrWriteImage( coolPath, coolFiles, geom.width, geom.height, {}, history.concat( [ anrHistory( "cool file" ) ] ) );
   anrInfo( "Unregistered stack written: " + stackPath );
   anrInfo( "Cool file written: " + coolPath );
   return coolFiles;
}

// ---------------------------------------------------------------------------
// Stage A
// ---------------------------------------------------------------------------

function anrCorrectedHistory( p, mask, step )
{
   const lines = [];
   if ( mask )
      lines.push( anrHistory( format( "RTN pixel mapping, ratio %.2f, CFA step %d, structure protection %s",
                                      p.rtnRatio, step,
                                      p.rtnProtectStructures ? format( "on (%.0f sigma per frame; in the stack %.0f sigma own excess or %.0f sigma footprint)",
                                                                       ANR_RTN_PROTECT_SIGMAS, ANR_STACK_PROTECT_SIGMAS, ANR_STACK_FOOTPRINT_SIGMAS ) : "off" ) ) );
   if ( p.coolEnabled )
      lines.push( anrHistory( format( "cool file correction, threshold %.2f sigma, CFA step %d, structure protection %s",
                                      p.coolSigma, step, p.coolProtectStructures ? "on" : "off" ) ) );
   return lines;
}

function anrWriteCorrectedLights( p, geom, step, mask, keep, coolFiles, outDir )
{
   anrHeader( "Writing corrected light frames" );
   const history = anrCorrectedHistory( p, mask, step );
   const outPaths = anrPlanOutputPaths( p.lightFiles, outDir, p.outputSuffix, ANR_OUTPUT_EXT, p.overwrite,
                                        path => File.exists( path ) );
   return p.lightFiles.map( ( path, i ) =>
   {
      anrCheckAbort();
      const frame = anrReadFrame( path );
      const prepared = anrPreparePlanes( frame, geom, step, mask, p.rtnProtectStructures, keep );
      const planes = coolFiles ? prepared.planes.map( ( plane, c ) => anrAddCoolFile( plane, coolFiles[ c ] ) )
                               : prepared.planes;
      const outPath = outPaths[ i ];
      anrWriteImage( outPath, planes, geom.width, geom.height, anrSourceMeta( frame ), history );
      anrInfo( format( "%d/%d: ", i + 1, p.lightFiles.length ) + outPath +
               ( mask ? format( " (RTN repaired: %d, kept on stars/outliers: %d, of which by the stack: %d)",
                                prepared.repaired, prepared.kept, prepared.stackKept ) : "" ) );
      return outPath;
   } );
}

/**
 * Runs Stage A and returns the list of corrected frame paths.
 */
function anrRunStageA( p )
{
   if ( p.lightFiles.length === 0 )
      throw new Error( "No light frames have been specified." );
   if ( !p.rtnEnabled && !p.coolEnabled )
      throw new Error( "Enable RTN pixel mapping and/or cool file correction." );
   if ( p.coolEnabled && p.lightFiles.length < ANR_MIN_COOL_FRAMES )
      throw new Error( format( "The cool file needs at least %d light frames.", ANR_MIN_COOL_FRAMES ) );

   const startTime = Date.now();
   const outDir = anrResolveOutputDir( p.outputDir, p.lightFiles );
   const first = anrReadFrame( p.lightFiles[ 0 ] );
   const geom = anrGeometryOf( first );
   const step = anrResolveStep( p.cfaMode, first );
   anrHeader( format( "Stage A: %d frames, %dx%dx%d, neighborhood step %d (%s)",
                      p.lightFiles.length, geom.width, geom.height, geom.channels, step,
                      ( step === 2 ) ? "Bayer CFA" : "mono/RGB" ) );
   anrInfo( "Output directory: " + outDir );

   const mask = p.rtnEnabled ? anrBuildDefectMask( p, geom, outDir ) : null;
   const protectByStack = mask !== null && p.rtnProtectStructures;
   const stacks = ( p.coolEnabled || protectByStack ) ? anrStackLights( p, geom, step, mask, protectByStack, p.coolEnabled ) : null;
   const keep = protectByStack ? anrStackProtection( stacks.raw[ 0 ], geom, step, mask ) : null;
   const coolFiles = p.coolEnabled ? anrBuildCoolFiles( p, geom, step, stacks.repaired, outDir ) : null;
   const outputs = anrWriteCorrectedLights( p, geom, step, mask, keep, coolFiles, outDir );

   anrHeader( format( "Stage A completed: %d frames in %.1f s", outputs.length, ( Date.now() - startTime ) / 1000 ) );
   return outputs;
}

// ---------------------------------------------------------------------------
// Stage B (Cosmicut)
// ---------------------------------------------------------------------------

function anrMasterKeywords( keywords, count )
{
   return keywords.filter( k => k.name.trim().toUpperCase() !== "NCOMBINE" )
                  .concat( [ new FITSKeyword( "NCOMBINE", count.toString(), "Number of combined frames" ) ] );
}

/**
 * Runs the Cosmicut composite on registered frames and returns the master path.
 */
function anrRunStageB( p )
{
   const files = p.registeredFiles;
   if ( files.length < ANR_MIN_COSMICUT_FRAMES )
      throw new Error( format( "Cosmicut needs at least %d registered frames.", ANR_MIN_COSMICUT_FRAMES ) );

   const startTime = Date.now();
   const outDir = anrResolveOutputDir( p.cosmicutOutputDir, files );
   anrHeader( format( "Stage B: Cosmicut composite of %d registered frames", files.length ) );

   let geom = null;
   let meta = null;
   let accumulators = null;
   files.forEach( ( path, i ) =>
   {
      anrCheckAbort();
      anrInfo( format( "Adding %d/%d: ", i + 1, files.length ) + path );
      const frame = anrReadFrame( path );
      if ( geom === null )
      {
         geom = anrGeometryOf( frame );
         meta = anrSourceMeta( frame );
         accumulators = frame.planes.map( () => new AnrCosmicutAccumulator( geom.width * geom.height, p.cosmicutExcludeZero ) );
      }
      anrCheckGeometry( frame, geom );
      frame.planes.forEach( ( plane, c ) => accumulators[ c ].add( plane ) );
   } );

   const history = [ anrHistory( format( "Cosmicut composite (sum - max)/(n - 1) of %d frames%s",
                                         files.length, p.cosmicutExcludeZero ? ", zero = no data" : "" ) ) ];
   const masterPath = anrOutputPath( outDir, p.cosmicutMasterName, p.overwrite );
   const masterMeta = { keywords: anrMasterKeywords( meta.keywords, files.length ),
                        properties: meta.properties, description: meta.description };
   anrWriteImage( masterPath, accumulators.map( a => a.result() ), geom.width, geom.height, masterMeta, history );
   anrInfo( "Master written: " + masterPath );

   if ( p.cosmicutSaveMax )
   {
      const maxPath = anrOutputPath( outDir, p.cosmicutMaxName, p.overwrite );
      anrWriteImage( maxPath, accumulators.map( a => a.maxImage() ), geom.width, geom.height, {},
                     [ anrHistory( "per-pixel maximum (rejected samples)" ) ] );
      anrInfo( "Rejected-maximum map written: " + maxPath );
   }

   anrHeader( format( "Stage B completed in %.1f s", ( Date.now() - startTime ) / 1000 ) );
   return masterPath;
}
