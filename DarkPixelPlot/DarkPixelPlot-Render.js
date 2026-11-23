// ----------------------------------------------------------------------------
// DarkPixelPlot-Render.js - draws the plot into a Bitmap (PJSR).
//   (a) whole range, log median axis (like the blog's colour camera plot)
//   (b) zoom on the normal pixels, linear median axis
// The fluctuation axis is logarithmic in both panels.
// ----------------------------------------------------------------------------

const DPP_CANVAS_W = 1180;
const DPP_CANVAS_H = 1370;
// the plot font depends on the language and the platform (Japanese glyphs)
const dppFontFor = () => dppFontFamily( dppLanguage(), CoreApplication.platform );
const DPP_COLOR = {
   surface: 0xFFFCFCFB, ink: 0xFF0B0B0B, ink2: 0xFF52514E, grid: 0xFFE1E0D9,
   mark: 0xFFEB6834, markFill: 0x30EB6834, densityKey: 0xFF256ABF
};
const DPP_SURFACE_RGB = [ 0xFC / 255, 0xFC / 255, 0xFB / 255 ];

function dppFont( px )
{
   const f = new Font( dppFontFor() );
   f.pixelSize = px;
   return f;
}

/** Text with an anchor: first letter l/c/r (horizontal), second t/m/b (vertical). */
function dppText( g, x, y, text, anchor, halo )
{
   const f = g.font;
   const w = f.width( text );
   const ascent = ( typeof f.ascent === "number" ) ? f.ascent : f.pixelSize * 0.8;
   const descent = ( typeof f.descent === "number" ) ? f.descent : f.pixelSize * 0.2;
   const h = anchor.charAt( 0 ), v = anchor.charAt( 1 );
   const x0 = ( h === "l" ) ? x : ( h === "c" ) ? x - w / 2 : x - w;
   const y0 = ( v === "t" ) ? y + ascent : ( v === "m" ) ? y + ( ascent - descent ) / 2 : y - descent;
   if ( halo )
   {
      const pen = g.pen;
      g.pen = new Pen( DPP_COLOR.surface );
      for ( const [ dx, dy ] of [ [ -2, 0 ], [ 2, 0 ], [ 0, -2 ], [ 0, 2 ], [ -1, -1 ], [ 1, 1 ], [ -1, 1 ], [ 1, -1 ] ] )
         g.drawText( x0 + dx, y0 + dy, text );
      g.pen = pen;
   }
   g.drawText( x0, y0, text );
   return w;
}

function dppDensityBitmap( grid )
{
   const n = grid.width * grid.height;
   const planes = [ new Float32Array( n ), new Float32Array( n ), new Float32Array( n ) ];
   const logMax = Math.max( Math.log10( Math.max( grid.max, 1 ) ), 1 );
   for ( let i = 0; i < n; ++i )
   {
      const c = grid.counts[ i ];
      const rgb = ( c === 0 ) ? null : dppRampColor( Math.log10( c ) / logMax );
      for ( let k = 0; k < 3; ++k )
         planes[ k ][ i ] = rgb ? rgb[ k ] / 255 : DPP_SURFACE_RGB[ k ];
   }
   const image = new Image( grid.width, grid.height, 3, ColorSpace.RGB, 32, PixelSampleType.Float );
   try
   {
      planes.forEach( ( plane, k ) => image.setSamples( plane, new Rect( 0, 0, grid.width, grid.height ), k ) );
      return image.render();
   }
   finally
   {
      image.free();
   }
}

const DPP_CURVE_POINTS = 400;
const DPP_DASH = [ 9, 6 ];   // dash and gap (pixels)

/** Polyline in pixel coordinates; points outside the panel break the line. */
function dppDrawCurve( g, points, inPanel, dashed )
{
   g.pen = new Pen( DPP_COLOR.ink2, 2 );
   const runs = [ [] ];
   for ( const p of points )
      if ( inPanel( p ) )
         runs[ runs.length - 1 ].push( p );
      else if ( runs[ runs.length - 1 ].length > 0 )
         runs.push( [] );
   for ( const run of runs )
   {
      const segments = dashed ? dppDashSegments( run, DPP_DASH[ 0 ], DPP_DASH[ 1 ] )
                              : run.slice( 1 ).map( ( p, k ) => run[ k ].concat( p ) );
      for ( const [ xa, ya, xb, yb ] of segments )
         g.drawLine( xa, ya, xb, yb );
   }
}

/**
 * One panel. spec: { box, xRange, xLog, yRange, xTicks, yTicks, title, xLabel, yLabel, notes, columnWidth }
 * Every point is drawn at its exact value; columnWidth only widens the drawn
 * columns of quantized values so that they stay visible.
 */
function dppPanel( g, stats, cls, marked, spec )
{
   const [ x0, y0, x1, y1 ] = spec.box;
   const ax = dppAxis( spec.xRange[ 0 ], spec.xRange[ 1 ], spec.xLog, x1 - x0 );
   const ay = dppAxis( spec.yRange[ 0 ], spec.yRange[ 1 ], true, y1 - y0 );
   const X = v => x0 + ax.pos( v ), Y = v => y1 - ay.pos( v );
   const small = dppFont( 16 );

   g.font = small;
   for ( const t of spec.yTicks )
   {
      g.pen = new Pen( DPP_COLOR.grid, 1 );
      g.drawLine( x0, Y( t ), x1, Y( t ) );
      g.pen = new Pen( DPP_COLOR.ink2 );
      dppText( g, x0 - 8, Y( t ), spec.yTickLabel( t ), "rm" );
   }
   for ( const t of spec.xTicks )
   {
      g.pen = new Pen( DPP_COLOR.grid, 1 );
      g.drawLine( X( t ), y0, X( t ), y1 );
      g.pen = new Pen( DPP_COLOR.ink2 );
      dppText( g, X( t ), y1 + 8, dppFormatInt( t ), "ct" );
   }

   const columnWidth = spec.columnWidth || 1;
   g.drawBitmap( x0, y0, dppDensityBitmap( dppWidenColumns( dppDensityGrid( stats.median, stats.std, ax, ay ), columnWidth ) ) );

   const brush = new Brush( DPP_COLOR.markFill );
   const halfX = Math.max( 1.6, columnWidth / 2 );
   g.pen = new Pen( 0x00000000, 0 );
   for ( const i of marked )
   {
      const xv = stats.median[ i ], yv = stats.std[ i ];
      if ( xv < ax.min || xv > ax.max || yv < ay.min || yv > ay.max )
         continue;
      const px = X( xv ), py = Y( yv );
      g.fillRect( px - halfX, py - 1.6, px + halfX, py + 1.6, brush );
   }

   // the noise model as smooth curves: typical fluctuation and the threshold guide
   const inPanel = ( [ px, py ] ) => py >= y0 && py <= y1;
   const toPixels = points => points.map( ( [ x, y ] ) => [ X( x ), Y( y ) ] );
   // the model's level is each pixel's lower quartile, the x axis shows medians:
   // move the knee to the normal median
   const drawn = Object.assign( {}, cls.stdModel, { base: cls.medianLevel } );
   dppDrawCurve( g, toPixels( dppModelCurve( drawn, ax, 1, DPP_CURVE_POINTS ) ), inPanel, false );
   dppDrawCurve( g, toPixels( dppModelCurve( drawn, ax, spec.ratio, DPP_CURVE_POINTS ) ), inPanel, true );

   g.pen = new Pen( DPP_COLOR.ink2, 1 );
   g.drawRect( x0, y0, x1, y1 );
   g.font = dppFont( 19 );
   g.pen = new Pen( DPP_COLOR.ink );
   dppText( g, x0, y0 - 12, spec.title, "lb" );
   g.font = small;
   g.pen = new Pen( DPP_COLOR.ink2 );
   dppText( g, x1, y0 - 12, spec.yLabel, "rb" );
   dppText( g, ( x0 + x1 ) / 2, y1 + 34, spec.xLabel, "ct" );
   g.pen = new Pen( DPP_COLOR.ink );
   for ( const note of spec.notes )
   {
      const nx = Math.min( Math.max( X( Math.min( Math.max( note.x, ax.min ), ax.max ) ), x0 + 8 ), x1 - 8 );
      const ny = Math.min( Math.max( Y( Math.min( Math.max( note.y, ay.min ), ay.max ) ), y0 + 12 ), y1 - 12 );
      dppText( g, nx, ny, note.text, note.anchor, true );
   }
}

function dppLegend( g, cls, options, quantum )
{
   const f = dppFont( 16 );
   g.font = f;
   let x = 130, y = 1215;
   const item = ( drawMark, text ) =>
   {
      drawMark( x, y );
      x += 28;
      g.pen = new Pen( DPP_COLOR.ink );
      x += dppText( g, x, y, text, "lm" ) + 34;
   };
   item( ( lx, ly ) => g.fillRect( lx, ly - 8, lx + 20, ly + 8, new Brush( DPP_COLOR.densityKey ) ), dppMsg( "legendDensity" ) );
   item( ( lx, ly ) => g.fillRect( lx + 4, ly - 6, lx + 16, ly + 6, new Brush( DPP_COLOR.mark ) ), options.markLabel );
   x = 130; y = 1248;
   item( ( lx, ly ) => { g.pen = new Pen( DPP_COLOR.ink2, 2 ); g.drawLine( lx, ly, lx + 22, ly ); }, dppMsg( "legendTypical" ) );
   item( ( lx, ly ) => { g.pen = new Pen( DPP_COLOR.ink2, 2 ); g.drawLine( lx, ly, lx + 8, ly ); g.drawLine( lx + 13, ly, lx + 22, ly ); },
         format( dppMsg( "legendThreshold" ), options.ratio ) );
   g.pen = new Pen( DPP_COLOR.ink2 );
   if ( quantum > 0 )
      dppText( g, x, y, format( dppMsg( "legendZoom" ), quantum ), "lm" );
   g.pen = new Pen( DPP_COLOR.ink );
   dppText( g, 130, 1283, format( dppMsg( "statsMarked" ), cls.typicalStd, dppFormatInt( cls.counts.noisy ), cls.noisyStdRatio ) +
                          ( options.outsideY > 0 ? format( dppMsg( "statsOutside" ), dppFormatInt( options.outsideY ) ) : "" ), "lm" );
   dppText( g, 130, 1311, format( dppMsg( "statsHot" ), DPP_HOT_SIGMAS, dppFormatInt( cls.counts.hot ), dppFormatInt( cls.counts.spikes ) ), "lm" );
   const model = cls.stdModel;
   g.pen = new Pen( DPP_COLOR.ink2 );
   dppText( g, 130, 1339, ( model.slope > 0 )
      ? format( dppMsg( "modelLine" ), model.read, model.slope, dppFormatInt( model.warmPixels ) )
      : format( dppMsg( "modelFlat" ), model.read ), "lm" );
}

/**
 * @param {object} options { title, ratio, markLabel, apranatAxis }
 * @returns {Bitmap}
 */
function dppRenderPlot( stats, cls, options )
{
   const m0 = cls.medianLevel, s0 = cls.typicalStd;
   // ranges stay valid for degenerate data (zero medians, flat or very quiet sets)
   const yRange = dppYRange( stats.std, options.apranatAxis );
   let maxMedian = 0, outsideY = 0;
   const marked = [];
   for ( let i = 0; i < stats.median.length; ++i )
   {
      if ( stats.median[ i ] > maxMedian )
         maxMedian = stats.median[ i ];
      if ( cls.noisy[ i ] )
         marked.push( i );
      if ( stats.std[ i ] > yRange[ 1 ] || stats.std[ i ] < yRange[ 0 ] )
         ++outsideY;
   }
   const yLabelText = dppMsg( options.apranatAxis ? "yLabelApranat" : "yLabel" );
   const yTickLabel = options.apranatAxis ? dppDecadeLabel : dppFormatInt;
   const xLow = Math.max( 1, dppPercentile( stats.median, 0.001 ) * 0.98 );
   const xFull = [ xLow, Math.max( maxMedian * 1.02, m0 * 2, xLow * 4 ) ];
   const zoomMargin = Math.max( 3 * s0, 5 );
   const quantum = dppQuantum( stats.median );
   // each value step spans a whole number of pixels, values at pixel centres
   const zoom = dppAlignedZoom( dppPercentile( stats.median, 0.5 ) - zoomMargin, dppPercentile( stats.median, 99.5 ) + zoomMargin,
                                quantum, 1140 - 130, stats.median[ 0 ] );
   const xZoom = [ zoom.min, zoom.max ];
   // apranat's axis: one tick per power of ten, edges included; otherwise no
   // tick right on the bottom edge, where its label would touch the x-axis labels
   const yTicks = options.apranatAxis ? dppDecadeTicks( yRange[ 0 ], yRange[ 1 ] ) : dppLogTicks( yRange[ 0 ] * 1.08, yRange[ 1 ] );

   const bitmap = new Bitmap( DPP_CANVAS_W, DPP_CANVAS_H );
   bitmap.fill( DPP_COLOR.surface );
   const g = new Graphics( bitmap );
   try
   {
      g.antialiasing = true;
      g.textAntialiasing = true;
      g.font = dppFont( 26 );
      g.pen = new Pen( DPP_COLOR.ink );
      dppText( g, 40, 30, options.title, "lt" );
      g.font = dppFont( 16 );
      g.pen = new Pen( DPP_COLOR.ink2 );
      dppText( g, 40, 72, format( dppMsg( "subtitle" ), stats.frames, stats.frames ), "lt" );

      dppPanel( g, stats, cls, marked, {
         box: [ 130, 140, 1140, 580 ], xRange: xFull, xLog: true, yRange: yRange, ratio: options.ratio,
         xTicks: dppLogTicks( xFull[ 0 ], xFull[ 1 ] ), yTicks: yTicks, yTickLabel: yTickLabel, columnWidth: 1,
         title: dppMsg( "panelA" ), xLabel: dppMsg( "xLabelA" ), yLabel: yLabelText,
         notes: [ { x: m0 * 1.04, y: s0 * 0.75, text: dppMsg( "noteNormal" ), anchor: "lm" },
                  { x: m0 * 1.04, y: s0 * 9, text: dppMsg( "noteDrunk" ), anchor: "lm" },
                  { x: m0 * 3.2, y: s0 * 4.5, text: dppMsg( "noteHot" ), anchor: "rm" } ]
      } );
      dppPanel( g, stats, cls, marked, {
         box: [ 130, 690, 1140, 1130 ], xRange: xZoom, xLog: false, yRange: yRange, ratio: options.ratio,
         xTicks: dppLinearTicks( xZoom[ 0 ], xZoom[ 1 ], 10 ), yTicks: yTicks, yTickLabel: yTickLabel, columnWidth: dppColumnWidth( zoom.pxPerStep ),
         title: dppMsg( "panelB" ), xLabel: dppMsg( "xLabelB" ), yLabel: yLabelText,
         notes: [ { x: m0, y: s0 * 0.6, text: dppMsg( "noteNormalZoom" ), anchor: "cm" },
                  { x: m0, y: s0 * 12, text: dppMsg( "noteDrunkZoom" ), anchor: "cm" } ]
      } );
      dppLegend( g, cls, Object.assign( {}, options, { outsideY: options.apranatAxis ? outsideY : 0 } ), quantum );
   }
   finally
   {
      g.end();
   }
   return bitmap;
}
