// ----------------------------------------------------------------------------
// ApranatNR-IO.js - image file I/O preserving FITS keywords / XISF properties
// ----------------------------------------------------------------------------

// Plain constants (no #define): this file is also bundled into the WBPP
// pipeline builder, where the PJSR preprocessor does not run.
// "raw cfa": camera raw files (CR2, NEF, ARW...) are read as the undebayered
// sensor data, like WBPP does; FITS and XISF ignore these hints
const ANR_IO_HINTS = "non-interactive raw cfa";
const ANR_OUTPUT_EXT = ".xisf";
const ANR_CFA_PROPERTY = "PCL:CFASourcePattern";
const ANR_BAYER_KEYWORD = "BAYERPAT";

function anrCheckAbort()
{
   CoreApplication.processEvents();
   if ( console.abortRequested )
      throw new Error( "<* abort *>" );
}

function anrReadProperties( format, instance )
{
   if ( !( format.canStoreImageProperties && format.supportsViewProperties ) )
      return [];
   const properties = [];
   const list = instance.imageProperties;
   for ( let i = 0; i < list.length; ++i )
   {
      const value = instance.readImageProperty( list[ i ][ 0 ] );
      if ( value != null )
         properties.push( { id: list[ i ][ 0 ], type: list[ i ][ 1 ], value: value } );
   }
   return properties;
}

/**
 * Reads an image file as 32-bit float planes.
 * @returns {{filePath: string, width: number, height: number, planes: Float32Array[],
 *            keywords: FITSKeyword[], properties: object[], description: ImageDescription}}
 */
function anrReadFrame( filePath )
{
   const suffix = File.extractExtension( filePath ).toLowerCase();
   const format = new FileFormat( suffix, true/*toRead*/, false/*toWrite*/ );
   if ( format.isNull )
      throw new Error( "No installed file format can read '" + suffix + "' files: " + filePath );

   const instance = new FileFormatInstance( format );
   if ( instance.isNull )
      throw new Error( "Unable to instantiate file format: " + format.name );

   const descriptions = instance.open( filePath, ANR_IO_HINTS );
   if ( !descriptions || descriptions.length < 1 )
      throw new Error( "Unable to open file: " + filePath );

   const image = new Image( 1, 1, 1, ColorSpace.Gray, 32, PixelSampleType.Float );
   try
   {
      if ( descriptions.length > 1 )
         throw new Error( "Multi-image files are not supported: " + filePath );
      if ( !instance.readImage( image ) )
         throw new Error( "Unable to read file: " + filePath );

      const width = image.width;
      const height = image.height;
      const planes = [];
      for ( let c = 0; c < image.numberOfChannels; ++c )
      {
         const plane = new Float32Array( width * height );
         image.getSamples( plane, new Rect( 0, 0, width, height ), c );
         planes.push( plane );
      }

      return {
         filePath: filePath,
         width: width,
         height: height,
         planes: planes,
         keywords: format.canStoreKeywords ? instance.keywords : [],
         properties: anrReadProperties( format, instance ),
         description: descriptions[ 0 ]
      };
   }
   finally
   {
      instance.close();
      image.free();
   }
}

function anrHistoryKeywords( lines )
{
   return lines.map( text => new FITSKeyword( "HISTORY", "", text ) );
}

/**
 * Writes float planes as a 32-bit float XISF file.
 * meta: { keywords?, properties?, description? } copied from a source frame.
 */
function anrWriteImage( filePath, planes, width, height, meta, historyLines )
{
   const channels = planes.length;
   const image = new Image( width, height, channels,
                            ( channels === 3 ) ? ColorSpace.RGB : ColorSpace.Gray,
                            32, PixelSampleType.Float );
   try
   {
      for ( let c = 0; c < channels; ++c )
         image.setSamples( planes[ c ], new Rect( 0, 0, width, height ), c );

      const format = new FileFormat( ANR_OUTPUT_EXT, false/*toRead*/, true/*toWrite*/ );
      if ( format.isNull )
         throw new Error( "The XISF file format is not available." );
      const instance = new FileFormatInstance( format );
      if ( instance.isNull )
         throw new Error( "Unable to instantiate file format: " + format.name );
      if ( !instance.create( filePath, ANR_IO_HINTS ) )
         throw new Error( "Error creating output file: " + filePath );

      try
      {
         const description = meta.description ? new ImageDescription( meta.description ) : new ImageDescription;
         description.bitsPerSample = 32;
         description.ieeefpSampleFormat = true;
         if ( !instance.setOptions( description ) )
            throw new Error( "Unable to set output file options: " + filePath );

         instance.keywords = ( meta.keywords || [] ).concat( anrHistoryKeywords( historyLines ) );
         ( meta.properties || [] ).forEach( p => instance.writeImageProperty( p.id, p.value, p.type ) );

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

function anrEnsureDirectory( dirPath )
{
   if ( !File.directoryExists( dirPath ) )
      File.createDirectory( dirPath, true/*createIntermediateDirectories*/ );
   return dirPath;
}

function anrOutputPath( dirPath, baseName, overwrite )
{
   const path = dirPath + "/" + baseName + ANR_OUTPUT_EXT;
   if ( overwrite || !File.exists( path ) )
      return path;
   for ( let u = 1; ; ++u )
   {
      const candidate = dirPath + "/" + baseName + "_" + u + ANR_OUTPUT_EXT;
      if ( !File.exists( candidate ) )
         return candidate;
   }
}

function anrDirectoryOf( filePath )
{
   return File.extractDrive( filePath ) + File.extractDirectory( filePath );
}

/**
 * True when a single-channel frame carries a Bayer CFA pattern (XISF property
 * or BAYERPAT keyword). Already debayered (RGB) frames are never CFA.
 */
function anrFrameLooksCfa( frame )
{
   if ( frame.planes.length !== 1 )
      return false;
   if ( frame.properties.some( p => p.id === ANR_CFA_PROPERTY ) )
      return true;
   return frame.keywords.some( k => k.name.trim().toUpperCase() === ANR_BAYER_KEYWORD );
}
