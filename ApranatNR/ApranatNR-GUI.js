// ----------------------------------------------------------------------------
// ApranatNR-GUI.js - dialog
// ----------------------------------------------------------------------------

const ANR_LIST_HEIGHT_MAIN = 160;
const ANR_LIST_HEIGHT_SMALL = 90;
const ANR_LIST_MIN_WIDTH = 560;
// labels of the left column, whose widest text sets the column width
const ANR_LABEL_KEYS = [ "cfaLabel", "defectMapLabel", "rtnRatioLabel", "coolSigmaLabel", "suffixLabel", "outputDirLabel" ];
const ANR_LANGUAGE_SETTING = "ApranatNR/language";

/** Restores the dialog language chosen last time (English when none). */
function anrLoadLanguageSetting()
{
   const value = Settings.read( ANR_LANGUAGE_SETTING, DataType_String );
   if ( Settings.lastReadOK )
      anrSetLanguage( value );
}

/** Language selector; onChange runs after the new language is selected and saved. */
function anrLanguageSelector( dialog, onChange )
{
   const label = new Label( dialog );
   label.text = anrText( "language" );
   label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   const combo = new ComboBox( dialog );
   ANR_LANGUAGES.forEach( language => combo.addItem( ANR_LANGUAGE_NAMES[ language ] ) );
   combo.currentItem = ANR_LANGUAGES.indexOf( anrLanguage() );
   combo.onItemSelected = index =>
   {
      if ( ANR_LANGUAGES[ index ] === anrLanguage() )
         return;
      anrSetLanguage( ANR_LANGUAGES[ index ] );
      Settings.write( ANR_LANGUAGE_SETTING, DataType_String, anrLanguage() );
      onChange();
   };
   const sizer = new HorizontalSizer;
   sizer.spacing = 4;
   sizer.add( label );
   sizer.add( combo );
   return sizer;
}

function anrFileListGroup( dialog, title, params, key, minHeight )
{
   const group = new GroupBox( dialog );
   const updateTitle = () => { group.title = title + " (" + params[ key ].length + ")"; };

   const tree = new TreeBox( dialog );
   tree.multipleSelection = true;
   tree.rootDecoration = false;
   tree.alternateRowColor = true;
   tree.numberOfColumns = 1;
   tree.headerVisible = false;
   tree.setScaledMinSize( ANR_LIST_MIN_WIDTH, minHeight );

   const rebuild = () =>
   {
      tree.canUpdate = false;
      tree.clear();
      params[ key ].forEach( path => { new TreeBoxNode( tree ).setText( 0, path ); } );
      tree.canUpdate = true;
      updateTitle();
   };

   const addButton = new PushButton( dialog );
   addButton.text = anrText( "add" );
   addButton.icon = dialog.scaledResource( ":/icons/add.png" );
   addButton.onClick = () =>
   {
      const ofd = new OpenFileDialog;
      ofd.multipleSelections = true;
      ofd.caption = title;
      ofd.loadImageFilters();
      if ( ofd.execute() )
      {
         params[ key ] = params[ key ].concat( ofd.filePaths.filter( p => params[ key ].indexOf( p ) < 0 ) );
         rebuild();
      }
   };

   const removeButton = new PushButton( dialog );
   removeButton.text = anrText( "removeSelected" );
   removeButton.icon = dialog.scaledResource( ":/icons/delete.png" );
   removeButton.onClick = () =>
   {
      const kept = [];
      for ( let i = 0; i < tree.numberOfChildren; ++i )
         if ( !tree.child( i ).selected )
            kept.push( tree.child( i ).text( 0 ) );
      params[ key ] = kept;
      rebuild();
   };

   const clearButton = new PushButton( dialog );
   clearButton.text = anrText( "clear" );
   clearButton.icon = dialog.scaledResource( ":/icons/clear.png" );
   clearButton.onClick = () => { params[ key ] = []; rebuild(); };

   const buttons = new HorizontalSizer;
   buttons.spacing = 4;
   buttons.add( addButton );
   buttons.addStretch();
   buttons.add( removeButton );
   buttons.add( clearButton );

   group.sizer = new VerticalSizer;
   group.sizer.margin = 6;
   group.sizer.spacing = 4;
   group.sizer.add( tree, 100 );
   group.sizer.add( buttons );
   rebuild();
   return group;
}

function anrPathRow( dialog, labelText, labelWidth, params, key, isDirectory, toolTip )
{
   const label = new Label( dialog );
   label.text = labelText;
   label.minWidth = labelWidth;
   label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;

   const edit = new Edit( dialog );
   edit.text = params[ key ];
   edit.toolTip = toolTip;
   // kept up to date while typing, so a language switch (which rebuilds the dialog) loses nothing
   edit.onTextUpdated = text => { params[ key ] = File.windowsPathToUnix( text.trim() ); };
   edit.onEditCompleted = function()
   {
      this.text = params[ key ] = File.windowsPathToUnix( this.text.trim() );
   };

   const select = new ToolButton( dialog );
   select.icon = dialog.scaledResource( ":/browser/select-file.png" );
   select.setScaledFixedSize( 20, 20 );
   select.toolTip = anrText( "browseTip" );
   select.onClick = () =>
   {
      const fd = isDirectory ? new GetDirectoryDialog : new OpenFileDialog;
      fd.caption = labelText;
      if ( !isDirectory )
         fd.loadImageFilters();
      if ( fd.execute() )
         edit.text = params[ key ] = isDirectory ? fd.directoryPath : fd.fileName;
   };

   const clear = new ToolButton( dialog );
   clear.icon = dialog.scaledResource( ":/icons/clear.png" );
   clear.setScaledFixedSize( 20, 20 );
   clear.toolTip = anrText( "clearTip" );
   clear.onClick = () => { edit.text = params[ key ] = ""; };

   const sizer = new HorizontalSizer;
   sizer.spacing = 4;
   sizer.add( label );
   sizer.add( edit, 100 );
   sizer.add( clear );
   sizer.add( select );
   return sizer;
}

function anrNumericControl( dialog, labelText, labelWidth, range, precision, value, toolTip, onChange )
{
   const control = new NumericControl( dialog );
   control.label.text = labelText;
   control.label.minWidth = labelWidth;
   control.setRange( range[ 0 ], range[ 1 ] );
   control.slider.setRange( 0, 1000 );
   control.slider.setScaledMinWidth( 250 );
   control.setPrecision( precision );
   control.setReal( true );
   control.setValue( value );
   control.toolTip = toolTip;
   control.onValueUpdated = onChange;
   return control;
}

function anrCheckBox( dialog, text, checked, toolTip, onCheck )
{
   const box = new CheckBox( dialog );
   box.text = text;
   box.checked = checked;
   box.toolTip = toolTip;
   box.onCheck = onCheck;
   return box;
}

function anrIndented( dialog, control, labelWidth )
{
   const sizer = new HorizontalSizer;
   sizer.addUnscaledSpacing( labelWidth + dialog.logicalPixelsToPhysical( 4 ) );
   sizer.add( control );
   sizer.addStretch();
   return sizer;
}

function anrButtonRow( button )
{
   const sizer = new HorizontalSizer;
   sizer.addStretch();
   sizer.add( button );
   return sizer;
}

function anrVerticalGroup( dialog, title, items )
{
   const group = new GroupBox( dialog );
   group.title = title;
   group.sizer = new VerticalSizer;
   group.sizer.margin = 6;
   group.sizer.spacing = 4;
   items.forEach( item => group.sizer.add( item ) );
   return group;
}

class AnrDialog extends Dialog
{
   constructor( params )
   {
      super();
      this.params = params;
      this.relaunch = false;
      this.labelWidth = Math.max.apply( null, ANR_LABEL_KEYS.map( key => this.font.width( anrText( key ) + "MM" ) ) );

      const info = new Label( this );
      info.wordWrapping = true;
      info.useRichText = true;
      info.text = format( anrText( "info" ), ANR_TITLE, ANR_VERSION );

      this.tabs = new TabBox( this );
      this.tabs.addPage( this.buildStageAPage(), anrText( "tabStageA" ) );
      this.tabs.addPage( this.buildStageBPage(), anrText( "tabStageB" ) );

      const overwrite = new CheckBox( this );
      overwrite.text = anrText( "overwrite" );
      overwrite.checked = params.overwrite;
      overwrite.toolTip = anrText( "overwriteTip" );
      overwrite.onCheck = checked => { params.overwrite = checked; };

      const close = new PushButton( this );
      close.text = anrText( "close" );
      close.icon = this.scaledResource( ":/icons/close.png" );
      close.onClick = () => { this.cancel(); };

      const bottom = new HorizontalSizer;
      bottom.spacing = 8;
      bottom.add( overwrite );
      bottom.addStretch();
      bottom.add( anrLanguageSelector( this, () => { this.relaunch = true; this.cancel(); } ) );
      bottom.addSpacing( 8 );
      bottom.add( close );

      this.sizer = new VerticalSizer;
      this.sizer.margin = 8;
      this.sizer.spacing = 8;
      this.sizer.add( info );
      this.sizer.add( this.tabs, 100 );
      this.sizer.add( bottom );

      this.windowTitle = ANR_TITLE;
      this.userResizable = true;
      this.adjustToContents();
   }

   buildStageAPage()
   {
      const p = this.params;
      const page = new Control( this );
      const lw = this.labelWidth;

      const lights = anrFileListGroup( this, anrText( "lightsGroup" ), p, "lightFiles", ANR_LIST_HEIGHT_MAIN );

      const cfaLabel = new Label( this );
      cfaLabel.text = anrText( "cfaLabel" );
      cfaLabel.minWidth = lw;
      cfaLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      const cfaCombo = new ComboBox( this );
      cfaCombo.addItem( anrText( "cfaAuto" ) );
      cfaCombo.addItem( anrText( "cfaMono" ) );
      cfaCombo.addItem( anrText( "cfaBayer" ) );
      cfaCombo.currentItem = p.cfaMode;
      cfaCombo.toolTip = anrText( "cfaTip" );
      cfaCombo.onItemSelected = index => { p.cfaMode = index; };
      const cfaSizer = new HorizontalSizer;
      cfaSizer.spacing = 4;
      cfaSizer.add( cfaLabel );
      cfaSizer.add( cfaCombo );
      cfaSizer.addStretch();

      const darks = anrFileListGroup( this, anrText( "darksGroup" ), p, "darkFiles", ANR_LIST_HEIGHT_SMALL );
      const rtnGroup = anrVerticalGroup( this, anrText( "rtnGroup" ), [
         darks,
         anrPathRow( this, anrText( "defectMapLabel" ), lw, p, "rtnDefectMapPath", false, anrText( "defectMapTip" ) ),
         anrNumericControl( this, anrText( "rtnRatioLabel" ), lw, [ 1.5, 20 ], 2, p.rtnRatio, anrText( "rtnRatioTip" ),
                            v => { p.rtnRatio = v; } ),
         anrIndented( this, anrCheckBox( this, anrText( "protectStructures" ), p.rtnProtectStructures,
            format( anrText( "rtnProtectTip" ), ANR_RTN_PROTECT_SIGMAS, ANR_STACK_PROTECT_SIGMAS, ANR_STACK_FOOTPRINT_SIGMAS ),
            checked => { p.rtnProtectStructures = checked; } ), lw )
      ] );
      rtnGroup.titleCheckBox = true;
      rtnGroup.checked = p.rtnEnabled;
      rtnGroup.onCheck = checked => { p.rtnEnabled = checked; };

      const protect = anrCheckBox( this, anrText( "protectStructures" ), p.coolProtectStructures, anrText( "coolProtectTip" ),
         checked => { p.coolProtectStructures = checked; } );

      const coolGroup = anrVerticalGroup( this, anrText( "coolGroup" ), [
         anrNumericControl( this, anrText( "coolSigmaLabel" ), lw, [ 0, 10 ], 2, p.coolSigma, anrText( "coolSigmaTip" ),
                            v => { p.coolSigma = v; } ),
         anrIndented( this, protect, lw )
      ] );
      coolGroup.titleCheckBox = true;
      coolGroup.checked = p.coolEnabled;
      coolGroup.onCheck = checked => { p.coolEnabled = checked; };

      const suffixLabel = new Label( this );
      suffixLabel.text = anrText( "suffixLabel" );
      suffixLabel.minWidth = lw;
      suffixLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      const suffixEdit = new Edit( this );
      suffixEdit.text = p.outputSuffix;
      suffixEdit.setScaledFixedWidth( 100 );
      suffixEdit.onTextUpdated = text => { p.outputSuffix = text.trim(); };
      suffixEdit.onEditCompleted = function() { this.text = p.outputSuffix = this.text.trim(); };
      const suffixSizer = new HorizontalSizer;
      suffixSizer.spacing = 4;
      suffixSizer.add( suffixLabel );
      suffixSizer.add( suffixEdit );
      suffixSizer.addStretch();

      const outputGroup = anrVerticalGroup( this, anrText( "outputGroup" ), [
         anrPathRow( this, anrText( "outputDirLabel" ), lw, p, "outputDir", true, anrText( "outputDirTipA" ) ),
         suffixSizer
      ] );

      const run = new PushButton( this );
      run.text = anrText( "runStageA" );
      run.icon = this.scaledResource( ":/icons/power.png" );
      run.onClick = () => this.runStage( anrRunStageA, outputs => format( anrText( "doneStageA" ), outputs.length ) );

      page.sizer = new VerticalSizer;
      page.sizer.margin = 6;
      page.sizer.spacing = 6;
      page.sizer.add( lights, 100 );
      page.sizer.add( cfaSizer );
      page.sizer.add( rtnGroup );
      page.sizer.add( coolGroup );
      page.sizer.add( outputGroup );
      page.sizer.add( anrButtonRow( run ) );
      return page;
   }

   buildStageBPage()
   {
      const p = this.params;
      const page = new Control( this );
      const lw = this.labelWidth;

      const registered = anrFileListGroup( this, anrText( "registeredGroup" ), p, "registeredFiles", ANR_LIST_HEIGHT_MAIN );

      const excludeZero = new CheckBox( this );
      excludeZero.text = anrText( "excludeZero" );
      excludeZero.checked = p.cosmicutExcludeZero;
      excludeZero.toolTip = anrText( "excludeZeroTip" );
      excludeZero.onCheck = checked => { p.cosmicutExcludeZero = checked; };

      const saveMax = new CheckBox( this );
      saveMax.text = anrText( "saveMax" );
      saveMax.checked = p.cosmicutSaveMax;
      saveMax.onCheck = checked => { p.cosmicutSaveMax = checked; };

      const optionsGroup = anrVerticalGroup( this, anrText( "cosmicutGroup" ), [
         anrIndented( this, excludeZero, lw ),
         anrIndented( this, saveMax, lw ),
         anrPathRow( this, anrText( "outputDirLabel" ), lw, p, "cosmicutOutputDir", true, anrText( "outputDirTipB" ) )
      ] );

      const run = new PushButton( this );
      run.text = anrText( "runStageB" );
      run.icon = this.scaledResource( ":/icons/power.png" );
      run.onClick = () => this.runStage( anrRunStageB, masterPath => format( anrText( "doneStageB" ), ScriptErrors.escapeHTML( masterPath ) ) );

      page.sizer = new VerticalSizer;
      page.sizer.margin = 6;
      page.sizer.spacing = 6;
      page.sizer.add( registered, 100 );
      page.sizer.add( optionsGroup );
      page.sizer.add( anrButtonRow( run ) );
      return page;
   }

   runStage( stageFunction, successMessage )
   {
      console.show();
      console.abortEnabled = true;
      this.enabled = false;
      let isAborted = false;
      try
      {
         const result = stageFunction( this.params );
         ( new MessageBox( successMessage( result ), ANR_TITLE, StdIcon.Information, StdButton.Ok ) ).execute();
      }
      catch ( x )
      {
         isAborted = !ScriptErrors.report( x, true/*interactive*/, ANR_TITLE );
      }
      finally
      {
         console.abortEnabled = false;
         this.enabled = true;
      }
      if ( isAborted )
         this.cancel();
   }
}
