// ----------------------------------------------------------------------------
// DarkPixelPlot-Engine.js - reads the darks, computes, renders and saves.
// ----------------------------------------------------------------------------

const DPP_TITLE = "DarkPixelPlot";
const DPP_VERSION = "1.2.0";
// "raw cfa": camera raw files (CR2, NEF, ARW...) are read as the undebayered
// sensor data, like WBPP does; other formats ignore these hints
const DPP_IO_HINTS = "non-interactive raw cfa";
const DPP_HOT_SIGMAS = 20;
const DPP_DEFAULT_RATIO = 4.0;
const DPP_DEFAULT_OUTPUT_NAME = "dark_pixel_plot.png";
// fewer frames make the trimmed std (n - 2 samples) too noisy: many normal
// pixels would exceed the ratio by chance (same minimum as ApranatNR)
const DPP_MIN_RUN_FRAMES = 8;

class DppParameters
{
   darkFiles = [];
   mapPath = "";
   outputPath = "";
   title = "";
   ratio = DPP_DEFAULT_RATIO;
   apranatAxis = false;      // fluctuation axis fixed to 10^1..10^4 like apranat's plots
   openResult = true;
   language = "";            // unattended runs only (--lang); the dialog uses the saved setting
}

function dppCheckAbort()
{
   CoreApplication.processEvents();
   if ( console.abortRequested )
      throw new Error( "<* abort *>" );
}

/**
 * Reads the first channel of a single-image file as 32-bit float samples.
 * @returns {{width: number, height: number, channels: number, samples: Float32Array, keywords: FITSKeyword[]}}
 */
function dppReadImage( filePath )
{
   const suffix = File.extractExtension( filePath ).toLowerCase();
   const format = new FileFormat( suffix, true/*toRead*/, false/*toWrite*/ );
   if ( format.isNull )
      throw new Error( "No installed file format can read '" + suffix + "' files: " + filePath );
   const instance = new FileFormatInstance( format );
   if ( instance.isNull )
      throw new Error( "Unable to instantiate file format: " + format.name );
   const descriptions = instance.open( filePath, DPP_IO_HINTS );
   if ( !descriptions || descriptions.length < 1 )
      throw new Error( "Unable to open file: " + filePath );

   const image = new Image( 1, 1, 1, ColorSpace.Gray, 32, PixelSampleType.Float );
   try
   {
      if ( descriptions.length > 1 )
         throw new Error( "Multi-image files are not supported: " + filePath );
      if ( !instance.readImage( image ) )
         throw new Error( "Unable to read file: " + filePath );
      const samples = new Float32Array( image.width * image.height );
      image.getSamples( samples, new Rect( 0, 0, image.width, image.height ), 0 );
      return { width: image.width, height: image.height, channels: image.numberOfChannels, samples: samples,
               keywords: format.canStoreKeywords ? instance.keywords : [] };
   }
   finally
   {
      instance.close();
      image.free();
   }
}

/**
 * [0, 1] float samples to 16-bit ADU (exact for 16-bit integer files). Data
 * outside [0, 1] (unnormalized floats, bias-subtracted negatives) is rejected
 * rather than silently clipped.
 */
function dppToAdu( samples, filePath )
{
   let min = Infinity, max = -Infinity;
   for ( let i = 0; i < samples.length; ++i )
   {
      const v = samples[ i ];
      if ( !( v >= min ) ) min = Number.isFinite( v ) ? v : -Infinity;
      if ( !( v <= max ) ) max = Number.isFinite( v ) ? v : Infinity;
   }
   if ( !( min >= 0 && max <= 1 ) )
      throw new Error( format( "Pixel values outside the [0,1] range (min %g, max %g): use raw (uncalibrated) dark frames: ", min, max ) + filePath );
   return Uint16Array.from( samples, v => Math.round( v * 65535 ) );
}

function dppKeywordValue( keywords, name )
{
   const k = keywords.find( k => k.name.trim().toUpperCase() === name );
   return k ? k.strippedValue.trim() : "";
}

function dppDefaultTitle( keywords, frameCount )
{
   const parts = [];
   const exposure = parseFloat( dppKeywordValue( keywords, "EXPTIME" ) || dppKeywordValue( keywords, "EXPOSURE" ) );
   if ( Number.isFinite( exposure ) )
      parts.push( format( dppMsg( "titleExposure" ), exposure ) );
   const gain = dppKeywordValue( keywords, "GAIN" );
   const iso = dppKeywordValue( keywords, "ISOSPEED" ) || dppKeywordValue( keywords, "ISO" );
   if ( gain.length > 0 )
      parts.push( "Gain " + gain );
   else if ( iso.length > 0 )
      parts.push( "ISO " + iso );
   parts.push( format( dppMsg( "titleFrames" ), frameCount ) );
   return format( dppMsg( "titleFormat" ), parts.join( dppMsg( "titleSeparator" ) ) );
}

function dppDefaultOutputPath( firstFile )
{
   return File.extractDrive( firstFile ) + File.extractDirectory( firstFile ) + "/" + DPP_DEFAULT_OUTPUT_NAME;
}

/** The graph is always written as PNG: a missing or other extension becomes .png. */
function dppPngPath( path )
{
   return /\.png$/i.test( path ) ? path : path + ".png";
}

function dppReadDarks( files )
{
   let geometry = null, keywords = [];
   const frames = files.map( ( path, i ) =>
   {
      dppCheckAbort();
      console.writeln( "<end><cbr><raw>" + format( "Dark %d/%d: ", i + 1, files.length ) + path + "</raw>" );
      const img = dppReadImage( path );
      if ( img.channels !== 1 )
         throw new Error( "Dark frames must be single-channel (not debayered); camera raw files are read undebayered automatically: " + path );
      if ( geometry === null )
      {
         geometry = { width: img.width, height: img.height };
         keywords = img.keywords;
      }
      else if ( img.width !== geometry.width || img.height !== geometry.height )
         throw new Error( "Dark frame size does not match the first frame: " + path );
      return dppToAdu( img.samples, path );
   } );
   return { frames: frames, width: geometry.width, height: geometry.height, keywords: keywords };
}

function dppReadMap( filePath, width, height )
{
   const img = dppReadImage( filePath );
   if ( img.width !== width || img.height !== height )
      throw new Error( "The defect map size does not match the dark frames: " + filePath );
   return Uint8Array.from( img.samples, v => ( v > 0.5 ) ? 1 : 0 );
}

function dppModelSummary( model )
{
   // base: median of the pixels' lower-quartile levels, about 0.67 read noise below the median level
   return { lowerQuartileBaseADU: model.base, readNoiseADU: model.read, shotSlope: model.slope, warmPixels: model.warmPixels };
}

/**
 * Runs the whole analysis. Returns the written PNG and JSON paths and the summary.
 */
function dppRun( p )
{
   if ( p.darkFiles.length < DPP_MIN_RUN_FRAMES )
      throw new Error( format( "At least %d individual dark frames are required (%d given).", DPP_MIN_RUN_FRAMES, p.darkFiles.length ) );
   if ( !( p.ratio >= 1.5 && p.ratio <= 20 ) )
      throw new Error( "The fluctuation ratio must be between 1.5 and 20." );
   const startTime = Date.now();
   console.noteln( "<end><cbr><br>* " + DPP_TITLE + ": reading " + p.darkFiles.length + " dark frames" );
   const darks = dppReadDarks( p.darkFiles );
   console.noteln( "* " + DPP_TITLE + ": per-pixel statistics" );
   const stats = dppPixelStats( darks.frames );
   const map = ( p.mapPath.length > 0 ) ? dppReadMap( p.mapPath, darks.width, darks.height ) : null;
   const cls = dppClassify( stats, p.ratio, DPP_HOT_SIGMAS, map );

   const title = ( p.title.length > 0 ) ? p.title : dppDefaultTitle( darks.keywords, stats.frames );
   const markLabel = map ? format( dppMsg( "markMap" ), File.extractName( p.mapPath ) ) : format( dppMsg( "markOwn" ), p.ratio );
   console.noteln( "* " + DPP_TITLE + ": drawing" );
   const bitmap = dppRenderPlot( stats, cls, { title: title, ratio: p.ratio, markLabel: markLabel, apranatAxis: p.apranatAxis } );

   const outputPath = dppPngPath( ( p.outputPath.length > 0 ) ? p.outputPath : dppDefaultOutputPath( p.darkFiles[ 0 ] ) );
   const dir = File.extractDrive( outputPath ) + File.extractDirectory( outputPath );
   if ( dir.length > 0 && !File.directoryExists( dir ) )
      File.createDirectory( dir, true );
   if ( bitmap.save( outputPath ) === false || !File.exists( outputPath ) )
      throw new Error( "Unable to write the graph: " + outputPath );

   const summary = {
      frames: stats.frames, width: darks.width, height: darks.height,
      medianLevelADU: cls.medianLevel, typicalStdADU: cls.typicalStd,
      markedPixels: cls.counts.noisy, markedStdRatio: cls.noisyStdRatio, mapUsed: map !== null,
      hotPixels: cls.counts.hot, oneFrameSpikes: cls.counts.spikes, ratio: p.ratio,
      // typical^2 = readNoise^2 + shotSlope * max(0, level - base), ADU (plain std / trimmed std)
      noiseModel: dppModelSummary( cls.stdModel ), trimmedNoiseModel: dppModelSummary( cls.trimmedModel ),
      yAxis: p.apranatAxis ? "apranat (10^1 - 10^4)" : "auto"
   };
   const jsonPath = outputPath.replace( /\.[^.\\/]*$/, "" ) + ".json";
   File.writeTextFile( jsonPath, JSON.stringify( summary, null, 2 ) + "\n" );

   console.noteln( format( "* %s: typical fluctuation %.1f ADU, marked %d px (x%.1f), hot %d px, one-frame spikes %d px",
                           DPP_TITLE, cls.typicalStd, cls.counts.noisy, cls.noisyStdRatio, cls.counts.hot, cls.counts.spikes ) );
   console.noteln( format( "* %s: noise model: read noise %.2f ADU, shot-noise slope %.3f ADU (%d warm pixels)",
                           DPP_TITLE, cls.trimmedModel.read, cls.trimmedModel.slope, cls.trimmedModel.warmPixels ) );
   console.noteln( "* " + DPP_TITLE + ": written " + outputPath + format( " (%.1f s)", ( Date.now() - startTime ) / 1000 ) );
   return { pngPath: outputPath, jsonPath: jsonPath, summary: summary };
}
