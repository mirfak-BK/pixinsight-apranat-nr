// ----------------------------------------------------------------------------
// FlatSmooth-Engine.js - reads the master flat, measures, smooths and saves.
// ----------------------------------------------------------------------------

const FS_TITLE = "FlatSmooth";
const FS_VERSION = "1.0.0";
const FS_IO_HINTS = "non-interactive raw cfa";
const FS_OUTPUT_SUFFIX = "_smooth";
const FS_OUTPUT_EXT = ".xisf";
const FS_DEFAULT_TARGET_PERCENT = 0.3;
const FS_DEFAULT_FIXED_RADIUS = 4;
const FS_CFA_PROPERTY = "PCL:CFASourcePattern";
const FS_BAYER_KEYWORD = "BAYERPAT";

class FsParameters
{
   inputPath = "";
   outputPath = "";
   cfaMode = "auto";                        // "auto" | "on" | "off"
   autoRadius = true;
   targetPercent = FS_DEFAULT_TARGET_PERCENT;
   fixedRadius = FS_DEFAULT_FIXED_RADIUS;
   openResult = true;
   language = "";                           // unattended runs only (--lang)
}

/** Validates parameters before any file is read; throws with a clear message. */
function fsValidate( p )
{
   if ( !p.inputPath )
      throw new Error( "No master flat given." );
   if ( !File.exists( p.inputPath ) )
      throw new Error( "File not found: " + p.inputPath );
   if ( [ "auto", "on", "off" ].indexOf( p.cfaMode ) < 0 )
      throw new Error( "CFA mode must be auto, on or off: " + p.cfaMode );
   if ( p.autoRadius && !( p.targetPercent > 0 && p.targetPercent < 100 ) )
      throw new Error( "The noise target must be between 0 and 100 %: " + p.targetPercent );
   if ( !p.autoRadius && !( Number.isInteger( p.fixedRadius ) && p.fixedRadius >= 1 && p.fixedRadius <= FS_MAX_RADIUS ) )
      throw new Error( "The radius must be an integer from 1 to " + FS_MAX_RADIUS + ": " + p.fixedRadius );
}

function fsReadProperties( format, instance )
{
   if ( !( format.canStoreImageProperties && format.supportsViewProperties ) )
      return [];
   const list = instance.imageProperties;
   const properties = [];
   for ( let i = 0; i < list.length; ++i )
   {
      const value = instance.readImageProperty( list[ i ][ 0 ] );
      if ( value != null )
         properties.push( { id: list[ i ][ 0 ], type: list[ i ][ 1 ], value: value } );
   }
   return properties;
}

/** Reads an image file as 32-bit float planes with its keywords and properties. */
function fsReadImage( filePath )
{
   const suffix = File.extractExtension( filePath ).toLowerCase();
   const format = new FileFormat( suffix, true/*toRead*/, false/*toWrite*/ );
   if ( format.isNull )
      throw new Error( "No installed file format can read '" + suffix + "' files: " + filePath );
   const instance = new FileFormatInstance( format );
   if ( instance.isNull )
      throw new Error( "Unable to instantiate file format: " + format.name );
   const descriptions = instance.open( filePath, FS_IO_HINTS );
   if ( !descriptions || descriptions.length < 1 )
      throw new Error( "Unable to open file: " + filePath );
   const image = new Image( 1, 1, 1, ColorSpace.Gray, 32, PixelSampleType.Float );
   try
   {
      // WBPP masters also hold rejection maps after the main image: readImage
      // reads the first (main) image; the rejection maps are not copied
      if ( !instance.readImage( image ) )
         throw new Error( "Unable to read file: " + filePath );
      const planes = [];
      for ( let c = 0; c < image.numberOfChannels; ++c )
      {
         const plane = new Float32Array( image.width * image.height );
         image.getSamples( plane, new Rect( 0, 0, image.width, image.height ), c );
         planes.push( plane );
      }
      return { width: image.width, height: image.height, planes: planes,
               keywords: format.canStoreKeywords ? instance.keywords : [],
               properties: fsReadProperties( format, instance ), description: descriptions[ 0 ] };
   }
   finally
   {
      instance.close();
      image.free();
   }
}

/** Writes float planes as a 32-bit float XISF file, keeping keywords and properties. */
function fsWriteImage( filePath, planes, width, height, source, historyLines )
{
   const channels = planes.length;
   const image = new Image( width, height, channels, ( channels === 3 ) ? ColorSpace.RGB : ColorSpace.Gray, 32, PixelSampleType.Float );
   try
   {
      planes.forEach( ( plane, c ) => image.setSamples( plane, new Rect( 0, 0, width, height ), c ) );
      const format = new FileFormat( FS_OUTPUT_EXT, false/*toRead*/, true/*toWrite*/ );
      if ( format.isNull )
         throw new Error( "The XISF file format is not available." );
      const instance = new FileFormatInstance( format );
      if ( instance.isNull || !instance.create( filePath, FS_IO_HINTS ) )
         throw new Error( "Error creating output file: " + filePath );
      try
      {
         const description = new ImageDescription( source.description );
         description.bitsPerSample = 32;
         description.ieeefpSampleFormat = true;
         if ( !instance.setOptions( description ) )
            throw new Error( "Unable to set output file options: " + filePath );
         instance.keywords = source.keywords.concat( historyLines.map( t => new FITSKeyword( "HISTORY", "", t ) ) );
         source.properties.forEach( q => instance.writeImageProperty( q.id, q.value, q.type ) );
         if ( !instance.writeImage( image ) )
            throw new Error( "Error writing output file: " + filePath );
      }
      finally
      {
         instance.close();
      }
   }
   finally
   {
      image.free();
   }
}

/** Bayer pattern string ("RGGB"...) from the CFA property or BAYERPAT keyword; "" when none. */
function fsCfaPattern( image )
{
   const prop = image.properties.filter( q => q.id === FS_CFA_PROPERTY )[ 0 ];
   if ( prop )
      return String( prop.value ).trim().toUpperCase();
   const kw = image.keywords.filter( k => k.name.trim() === FS_BAYER_KEYWORD )[ 0 ];
   return kw ? kw.strippedValue.trim().toUpperCase() : "";
}

/** CFA step (2 for a Bayer mosaic, 1 otherwise) for the chosen mode. */
function fsCfaStep( image, mode )
{
   const pattern = fsCfaPattern( image );
   if ( pattern.length > 4 )
      throw new Error( "Only 2x2 (Bayer) CFA patterns are supported, not " + pattern );
   if ( mode === "on" || ( mode === "auto" && image.planes.length === 1 && pattern.length === 4 ) )
   {
      if ( image.planes.length !== 1 )
         throw new Error( "A CFA mosaic must have one channel; this image has " + image.planes.length );
      return 2;
   }
   return 1;
}

function fsDefaultOutputPath( inputPath )
{
   return File.extractDrive( inputPath ) + File.extractDirectory( inputPath ) + "/" +
          File.extractName( inputPath ) + FS_OUTPUT_SUFFIX + FS_OUTPUT_EXT;
}

function fsPhaseLabel( pattern, step, dx, dy )
{
   const colour = ( step === 2 && pattern.length === 4 ) ? pattern[ dx + 2 * dy ] + " " : "";
   return colour + "(" + dx + "," + dy + ")";
}

/**
 * Measures the flat and, when needed (or asked), smooths and writes it.
 * @param {FsParameters} p
 * @param {boolean} write  false only measures
 * @returns {object} summary for the dialog / JSON report
 */
function fsRun( p, write )
{
   fsValidate( p );
   console.writeln( "<end><cbr><br>* " + FS_TITLE + " " + FS_VERSION + ": " + p.inputPath );
   const image = fsReadImage( p.inputPath );
   const step = fsCfaStep( image, p.cfaMode );
   const pattern = fsCfaPattern( image );
   const phases = [];
   image.planes.forEach( ( plane, c ) =>
      fsAnalyzePlane( plane, image.width, image.height, step ).forEach( ph =>
         phases.push( { channel: c, label: ( image.planes.length > 1 ? "C" + c + " " : "" ) + fsPhaseLabel( pattern, step, ph.dx, ph.dy ),
                        mean: ph.mean, noise: ph.noise } ) ) );
   const noise = Math.max.apply( null, phases.map( ph => ph.noise ) );
   const target = p.targetPercent / 100;
   const radius = p.autoRadius ? fsChooseRadius( noise, target, FS_SMOOTH_PASSES ) : p.fixedRadius;
   const summary = {
      tool: FS_TITLE, version: FS_VERSION, input: p.inputPath, width: image.width, height: image.height,
      channels: image.planes.length, cfaStep: step, cfaPattern: pattern, phases: phases, noise: noise,
      autoRadius: p.autoRadius, target: target, radius: radius,
      residual: noise * fsNoiseFactor( radius, FS_SMOOTH_PASSES ), clipped: 0, output: "", written: false
   };
   phases.forEach( ph => console.writeln( format( "%s: level %.5f, pixel noise %.3f%%", ph.label, ph.mean, 100 * ph.noise ) ) );
   console.writeln( format( "Radius %d (%s): pixel noise %.3f%% -> %.4f%%", radius, p.autoRadius ? "auto" : "fixed",
                            100 * noise, 100 * summary.residual ) );
   if ( !write || radius === 0 )
      return summary;

   const output = p.outputPath || fsDefaultOutputPath( p.inputPath );
   if ( File.extractExtension( output ).toLowerCase() !== FS_OUTPUT_EXT )
      throw new Error( "The output file must be .xisf: " + output );
   if ( File.exists( output ) && output === p.inputPath )
      throw new Error( "The output would overwrite the input: " + output );
   const planes = image.planes.map( plane =>
   {
      const s = fsSmoothPlane( plane, image.width, image.height, step, radius, FS_SMOOTH_PASSES );
      summary.clipped += s.clipped;
      return s.plane;
   } );
   fsWriteImage( output, planes, image.width, image.height, image, [
      format( "%s %s: smoothed per %s, %d box passes of radius %d", FS_TITLE, FS_VERSION,
              step === 2 ? "CFA colour" : "channel", FS_SMOOTH_PASSES, radius ),
      format( "%s: pixel noise %.3f%% -> %.4f%%, %d outliers replaced", FS_TITLE, 100 * noise, 100 * summary.residual, summary.clipped )
   ] );
   console.writeln( "Written: " + output + " (" + summary.clipped + " outliers replaced)" );
   summary.output = output;
   summary.written = true;
   return summary;
}

/** HTML report of a summary in the current language. */
function fsReportHtml( s )
{
   const layout = ( s.cfaStep === 2 ) ? fsMsg( "layoutCfa" ) : format( fsMsg( "layoutPlain" ), s.channels );
   let html = format( fsMsg( "resultHeader" ), File.extractNameAndExtension( s.input ), s.width, s.height, layout );
   html += "<p>" + s.phases.map( ph => format( fsMsg( "phaseLine" ), ph.label, ph.mean, 100 * ph.noise ) ).join( "<br>" ) + "</p>";
   if ( s.radius === 0 )
      html += format( fsMsg( "verdictQuiet" ), 100 * s.noise, 100 * s.target );
   else if ( s.autoRadius )
      html += format( fsMsg( "verdictNoisy" ), 100 * s.noise, s.radius, 100 * s.residual );
   else
      html += format( fsMsg( "verdictFixed" ), s.radius, 100 * s.noise, 100 * s.residual );
   if ( s.written )
      html += format( fsMsg( "written" ), String( s.clipped ), s.output ) + fsMsg( "useInWbpp" );
   return html;
}
