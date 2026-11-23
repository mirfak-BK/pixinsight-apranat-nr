// ----------------------------------------------------------------------------
// DarkPixelPlot-GUI.js - dialog.
// ----------------------------------------------------------------------------

const DPP_IMAGE_EXTENSIONS = [ "*.fit", "*.fits", "*.fts", "*.xisf", "*.cr2", "*.cr3", "*.nef", "*.arw", "*.dng", "*.orf", "*.raf", "*.rw2" ];
const DPP_LANGUAGE_SETTING = "DarkPixelPlot/language";
const DPP_LABEL_KEYS = [ "mapLabel", "outLabel", "titleLabel", "ratioLabel" ];

function dppImageFilters()
{
   return [ [ dppMsg( "imageFiles" ) ].concat( DPP_IMAGE_EXTENSIONS ), [ dppMsg( "allFiles" ), "*" ] ];
}

/** Restores the language chosen last time (English when none). */
function dppLoadLanguageSetting()
{
   const value = Settings.read( DPP_LANGUAGE_SETTING, DataType_String );
   if ( Settings.lastReadOK )
      dppSetLanguage( value );
}

/** Language selector; onChange runs after the new language is selected and saved. */
function dppLanguageSelector( dialog, onChange )
{
   const label = new Label( dialog );
   label.text = dppMsg( "language" );
   label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   const combo = new ComboBox( dialog );
   DPP_LANGUAGES.forEach( language => combo.addItem( DPP_LANGUAGE_NAMES[ language ] ) );
   combo.currentItem = DPP_LANGUAGES.indexOf( dppLanguage() );
   combo.onItemSelected = index =>
   {
      if ( DPP_LANGUAGES[ index ] === dppLanguage() )
         return;
      dppSetLanguage( DPP_LANGUAGES[ index ] );
      Settings.write( DPP_LANGUAGE_SETTING, DataType_String, dppLanguage() );
      onChange();
   };
   const sizer = new HorizontalSizer;
   sizer.spacing = 4;
   sizer.add( label );
   sizer.add( combo );
   return sizer;
}

function dppPathRow( dialog, labelText, labelWidth, initial, toolTip, browse )
{
   const label = new Label( dialog );
   label.text = labelText;
   label.minWidth = labelWidth;
   label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   const edit = new Edit( dialog );
   edit.text = initial;
   edit.toolTip = toolTip;
   edit.minWidth = 360;
   const button = new ToolButton( dialog );
   button.icon = dialog.scaledResource( ":/icons/select-file.png" );
   button.setScaledFixedSize( 22, 22 );
   button.toolTip = toolTip;
   button.onClick = () => { const path = browse( edit.text ); if ( path ) edit.text = path; };
   const sizer = new HorizontalSizer;
   sizer.spacing = 4;
   sizer.add( label );
   sizer.add( edit, 100 );
   sizer.add( button );
   return { sizer: sizer, edit: edit };
}

class DppDialog extends Dialog
{
   constructor( params )
   {
      super();
      this.params = params;
      this.relaunch = false;
      const lw = Math.max.apply( null, DPP_LABEL_KEYS.map( key => this.font.width( dppMsg( key ) + "MM" ) ) );

      const info = new Label( this );
      info.wordWrapping = true;
      info.useRichText = true;
      info.text = format( dppMsg( "info" ), DPP_TITLE, DPP_VERSION );

      this.files = new TreeBox( this );
      this.files.rootDecoration = false;
      this.files.alternateRowColor = true;
      this.files.headerVisible = false;
      this.files.setScaledMinSize( 520, 180 );
      const addFiles = new PushButton( this );
      addFiles.text = dppMsg( "addFiles" );
      addFiles.onClick = () =>
      {
         const ofd = new OpenFileDialog;
         ofd.multipleSelections = true;
         ofd.caption = format( dppMsg( "selectDarks" ), DPP_MIN_RUN_FRAMES );
         ofd.filters = dppImageFilters();
         if ( ofd.execute() )
            ofd.fileNames.forEach( f => { if ( this.params.darkFiles.indexOf( f ) < 0 ) this.params.darkFiles.push( f ); } );
         this.updateFiles();
      };
      const clearFiles = new PushButton( this );
      clearFiles.text = dppMsg( "clear" );
      clearFiles.onClick = () => { this.params.darkFiles = []; this.updateFiles(); };
      const fileButtons = new HorizontalSizer;
      fileButtons.spacing = 6;
      fileButtons.add( addFiles );
      fileButtons.add( clearFiles );
      fileButtons.addStretch();
      this.countLabel = new Label( this );
      fileButtons.add( this.countLabel );
      const filesGroup = new GroupBox( this );
      filesGroup.title = format( dppMsg( "filesGroup" ), DPP_MIN_RUN_FRAMES );
      filesGroup.sizer = new VerticalSizer;
      filesGroup.sizer.margin = 6;
      filesGroup.sizer.spacing = 4;
      filesGroup.sizer.add( this.files, 100 );
      filesGroup.sizer.add( fileButtons );

      this.mapRow = dppPathRow( this, dppMsg( "mapLabel" ), lw, params.mapPath, dppMsg( "mapTip" ),
         () => { const d = new OpenFileDialog; d.filters = [ [ "XISF", "*.xisf" ] ]; return d.execute() ? d.fileName : ""; } );
      this.outRow = dppPathRow( this, dppMsg( "outLabel" ), lw, params.outputPath, format( dppMsg( "outTip" ), DPP_DEFAULT_OUTPUT_NAME ),
         () => { const d = new SaveFileDialog; d.filters = [ [ "PNG", "*.png" ] ]; return d.execute() ? d.fileName : ""; } );

      const titleLabel = new Label( this );
      titleLabel.text = dppMsg( "titleLabel" );
      titleLabel.minWidth = lw;
      titleLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      this.titleEdit = new Edit( this );
      this.titleEdit.text = params.title;
      this.titleEdit.toolTip = dppMsg( "titleTip" );
      const titleSizer = new HorizontalSizer;
      titleSizer.spacing = 4;
      titleSizer.add( titleLabel );
      titleSizer.add( this.titleEdit, 100 );

      this.ratio = new NumericControl( this );
      this.ratio.label.text = dppMsg( "ratioLabel" );
      this.ratio.label.minWidth = lw;
      this.ratio.setRange( 1.5, 20 );
      this.ratio.slider.setRange( 0, 185 );
      this.ratio.setPrecision( 1 );
      this.ratio.setReal( true );
      this.ratio.setValue( params.ratio );
      this.ratio.toolTip = dppMsg( "ratioTip" );

      this.apranatAxis = new CheckBox( this );
      this.apranatAxis.text = dppMsg( "apranatAxis" );
      this.apranatAxis.checked = params.apranatAxis;
      this.apranatAxis.toolTip = dppMsg( "apranatAxisTip" );
      const axisSizer = new HorizontalSizer;
      axisSizer.addUnscaledSpacing( lw + this.logicalPixelsToPhysical( 4 ) );
      axisSizer.add( this.apranatAxis );
      axisSizer.addStretch();

      this.openResult = new CheckBox( this );
      this.openResult.text = dppMsg( "openResult" );
      this.openResult.checked = params.openResult;

      const run = new PushButton( this );
      run.text = dppMsg( "run" );
      run.icon = this.scaledResource( ":/icons/power.png" );
      run.onClick = () => this.runPlot();
      const close = new PushButton( this );
      close.text = dppMsg( "close" );
      close.icon = this.scaledResource( ":/icons/close.png" );
      close.onClick = () => this.cancel();
      const buttons = new HorizontalSizer;
      buttons.spacing = 8;
      buttons.add( this.openResult );
      buttons.addStretch();
      buttons.add( dppLanguageSelector( this, () => { this.syncParams(); this.relaunch = true; this.cancel(); } ) );
      buttons.addSpacing( 8 );
      buttons.add( run );
      buttons.add( close );

      this.sizer = new VerticalSizer;
      this.sizer.margin = 8;
      this.sizer.spacing = 8;
      this.sizer.add( info );
      this.sizer.add( filesGroup, 100 );
      this.sizer.add( this.mapRow.sizer );
      this.sizer.add( this.outRow.sizer );
      this.sizer.add( titleSizer );
      this.sizer.add( this.ratio );
      this.sizer.add( axisSizer );
      this.sizer.add( buttons );
      this.windowTitle = DPP_TITLE;
      this.userResizable = true;
      this.updateFiles();
      this.adjustToContents();
   }

   updateFiles()
   {
      this.files.clear();
      this.params.darkFiles.forEach( f => { const node = new TreeBoxNode( this.files ); node.setText( 0, f ); } );
      this.countLabel.text = format( dppMsg( "frameCount" ), this.params.darkFiles.length );
   }

   /** Copies the edited values into the parameters. */
   syncParams()
   {
      const p = this.params;
      p.mapPath = this.mapRow.edit.text.trim();
      p.outputPath = this.outRow.edit.text.trim();
      p.title = this.titleEdit.text.trim();
      p.ratio = this.ratio.value;
      p.apranatAxis = this.apranatAxis.checked;
      p.openResult = this.openResult.checked;
   }

   runPlot()
   {
      const p = this.params;
      this.syncParams();
      this.enabled = false;
      console.show();
      try
      {
         const result = dppRun( p );
         if ( p.openResult )
         {
            const windows = ImageWindow.open( result.pngPath );
            if ( windows.length > 0 )
               windows[ 0 ].show();
         }
         ( new MessageBox( format( dppMsg( "done" ), ScriptErrors.escapeHTML( result.pngPath ) ),
                           DPP_TITLE, StdIcon.Information, StdButton.Ok ) ).execute();
      }
      catch ( x )
      {
         ScriptErrors.report( x, true/*interactive*/, DPP_TITLE );
      }
      finally
      {
         this.enabled = true;
      }
   }
}
