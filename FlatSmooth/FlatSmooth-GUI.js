// ----------------------------------------------------------------------------
// FlatSmooth-GUI.js - dialog.
// ----------------------------------------------------------------------------

#include <pjsr/DataType.jsh>

const FS_IMAGE_EXTENSIONS = [ "*.xisf", "*.fit", "*.fits", "*.fts" ];
const FS_LANGUAGE_SETTING = "FlatSmooth/language";
const FS_LABEL_KEYS = [ "inputLabel", "outputLabel", "cfaLabel", "radiusLabel" ];
const FS_CFA_MODES = [ "auto", "on", "off" ];
const FS_CFA_KEYS = [ "cfaAuto", "cfaOn", "cfaOff" ];

/** Restores the language chosen last time (English when none). */
function fsLoadLanguageSetting()
{
   const value = Settings.read( FS_LANGUAGE_SETTING, DataType_UCString );
   if ( Settings.lastReadOK )
      fsSetLanguage( value );
}

function fsLabel( parent, text, width )
{
   const label = new Label( parent );
   label.text = text;
   if ( width )
      label.minWidth = width;
   label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   return label;
}

function fsPathRow( dialog, labelText, labelWidth, initial, toolTip, browse )
{
   const edit = new Edit( dialog );
   edit.text = initial;
   edit.toolTip = toolTip;
   edit.minWidth = 380;
   const button = new ToolButton( dialog );
   button.icon = dialog.scaledResource( ":/icons/select-file.png" );
   button.setScaledFixedSize( 22, 22 );
   button.toolTip = toolTip;
   button.onClick = () => { const path = browse( edit.text ); if ( path ) edit.text = path; };
   const sizer = new HorizontalSizer;
   sizer.spacing = 4;
   sizer.add( fsLabel( dialog, labelText, labelWidth ) );
   sizer.add( edit, 100 );
   sizer.add( button );
   return { sizer: sizer, edit: edit };
}

function fsFileFilters()
{
   return [ [ fsMsg( "imageFiles" ) ].concat( FS_IMAGE_EXTENSIONS ), [ fsMsg( "allFiles" ), "*" ] ];
}

class FsDialog extends Dialog
{
   constructor( params )
   {
      super();
      this.params = params;
      this.relaunch = false;
      this.windowTitle = FS_TITLE;
      const lw = Math.max.apply( null, FS_LABEL_KEYS.map( key => this.font.width( fsMsg( key ) + "MM" ) ) );

      const info = new Label( this );
      info.useRichText = true;
      info.wordWrapping = true;
      info.minWidth = 560;
      info.text = format( fsMsg( "info" ), FS_TITLE, FS_VERSION );

      this.inputRow = fsPathRow( this, fsMsg( "inputLabel" ), lw, params.inputPath, fsMsg( "inputTip" ), current =>
      {
         const d = new OpenFileDialog;
         d.multipleSelections = false;
         d.filters = fsFileFilters();
         if ( current ) d.initialPath = current;
         return d.execute() ? d.fileName : "";
      } );
      this.outputRow = fsPathRow( this, fsMsg( "outputLabel" ), lw, params.outputPath, fsMsg( "outputTip" ), current =>
      {
         const d = new SaveFileDialog;
         d.filters = [ [ "XISF", "*.xisf" ] ];
         d.initialPath = current || ( this.inputRow.edit.text ? fsDefaultOutputPath( this.inputRow.edit.text.trim() ) : "" );
         return d.execute() ? d.fileName : "";
      } );

      this.cfaCombo = new ComboBox( this );
      FS_CFA_KEYS.forEach( key => this.cfaCombo.addItem( fsMsg( key ) ) );
      this.cfaCombo.currentItem = Math.max( 0, FS_CFA_MODES.indexOf( params.cfaMode ) );
      this.cfaCombo.toolTip = fsMsg( "cfaTip" );
      const cfaSizer = new HorizontalSizer;
      cfaSizer.spacing = 4;
      cfaSizer.add( fsLabel( this, fsMsg( "cfaLabel" ), lw ) );
      cfaSizer.add( this.cfaCombo );
      cfaSizer.addStretch();

      this.autoRadio = new RadioButton( this );
      this.autoRadio.text = fsMsg( "radiusAuto" );
      this.autoRadio.checked = params.autoRadius;
      this.autoRadio.toolTip = fsMsg( "radiusTip" );
      // a plain Edit: pjsr/NumericControl.jsh does not load under the V8 engine
      this.targetEdit = new Edit( this );
      this.targetEdit.text = String( params.targetPercent );
      this.targetEdit.setFixedWidth( this.font.width( "00.000M" ) );
      this.targetEdit.toolTip = fsMsg( "radiusTip" );
      this.fixedRadio = new RadioButton( this );
      this.fixedRadio.text = fsMsg( "radiusFixed" );
      this.fixedRadio.checked = !params.autoRadius;
      this.fixedRadio.toolTip = fsMsg( "radiusTip" );
      this.radiusSpin = new SpinBox( this );
      this.radiusSpin.minValue = 1;
      this.radiusSpin.maxValue = FS_MAX_RADIUS;
      this.radiusSpin.value = params.fixedRadius;
      this.radiusSpin.toolTip = fsMsg( "radiusTip" );
      const autoRow = new HorizontalSizer;
      autoRow.spacing = 4;
      autoRow.add( fsLabel( this, fsMsg( "radiusLabel" ), lw ) );
      autoRow.add( this.autoRadio );
      autoRow.add( this.targetEdit );
      autoRow.addStretch();
      const fixedRow = new HorizontalSizer;
      fixedRow.spacing = 4;
      fixedRow.addSpacing( lw + 4 );
      fixedRow.add( this.fixedRadio );
      fixedRow.add( this.radiusSpin );
      fixedRow.addStretch();

      this.openCheck = new CheckBox( this );
      this.openCheck.text = fsMsg( "openResult" );
      this.openCheck.checked = params.openResult;
      const openRow = new HorizontalSizer;
      openRow.addSpacing( lw + 4 );
      openRow.add( this.openCheck );
      openRow.addStretch();

      this.resultLabel = new Label( this );
      this.resultLabel.useRichText = true;
      this.resultLabel.wordWrapping = true;
      this.resultLabel.minHeight = 140;
      this.resultLabel.styleSheet = "QLabel { padding: 6px; }";
      this.resultLabel.frameStyle = FrameStyle.Box;

      const languageLabel = fsLabel( this, fsMsg( "language" ) );
      this.languageCombo = new ComboBox( this );
      FS_LANGUAGES.forEach( l => this.languageCombo.addItem( FS_LANGUAGE_NAMES[ l ] ) );
      this.languageCombo.currentItem = FS_LANGUAGES.indexOf( fsLanguage() );
      this.languageCombo.onItemSelected = index =>
      {
         if ( FS_LANGUAGES[ index ] === fsLanguage() )
            return;
         fsSetLanguage( FS_LANGUAGES[ index ] );
         Settings.write( FS_LANGUAGE_SETTING, DataType_UCString, fsLanguage() );
         this.collect();
         this.relaunch = true;
         this.cancel();
      };
      const analyze = new PushButton( this );
      analyze.text = fsMsg( "analyze" );
      analyze.onClick = () => this.execute_( false );
      const run = new PushButton( this );
      run.text = fsMsg( "run" );
      run.defaultButton = true;
      run.onClick = () => this.execute_( true );
      const close = new PushButton( this );
      close.text = fsMsg( "close" );
      close.onClick = () => this.cancel();
      const buttons = new HorizontalSizer;
      buttons.spacing = 6;
      buttons.add( languageLabel );
      buttons.add( this.languageCombo );
      buttons.addStretch();
      buttons.add( analyze );
      buttons.add( run );
      buttons.add( close );

      this.sizer = new VerticalSizer;
      this.sizer.margin = 8;
      this.sizer.spacing = 6;
      this.sizer.add( info );
      this.sizer.add( this.inputRow.sizer );
      this.sizer.add( this.outputRow.sizer );
      this.sizer.add( cfaSizer );
      this.sizer.add( autoRow );
      this.sizer.add( fixedRow );
      this.sizer.add( openRow );
      this.sizer.add( this.resultLabel, 100 );
      this.sizer.add( buttons );
      this.adjustToContents();
   }

   /** Copies the controls into the parameters (also kept across a language change). */
   collect()
   {
      const p = this.params;
      p.inputPath = this.inputRow.edit.text.trim();
      p.outputPath = this.outputRow.edit.text.trim();
      p.cfaMode = FS_CFA_MODES[ this.cfaCombo.currentItem ];
      p.autoRadius = this.autoRadio.checked;
      p.targetPercent = parseFloat( this.targetEdit.text );
      p.fixedRadius = this.radiusSpin.value;
      p.openResult = this.openCheck.checked;
   }

   execute_( write )
   {
      this.collect();
      if ( !this.params.inputPath )
      {
         this.resultLabel.text = "<p>" + fsMsg( "noFile" ) + "</p>";
         return;
      }
      try
      {
         const summary = fsRun( this.params, write );
         this.resultLabel.text = fsReportHtml( summary );
         if ( summary.written && this.params.openResult )
         {
            const windows = ImageWindow.open( summary.output );
            if ( windows.length > 0 )
               windows[ 0 ].show();
         }
      }
      catch ( x )
      {
         this.resultLabel.text = "<p><b>Error:</b> " + x.message + "</p>";
         console.criticalln( x.toString() );
      }
   }
}
