// ----------------------------------------------------------------------------
// FlatSmooth-DialogTest.js - builds the dialog in every language in a
// headless PixInsight instance. Writes <system temp>/FlatSmooth-dialog.txt
// N.B. never write a slash followed by an asterisk in a line comment.
// ----------------------------------------------------------------------------

#engine v8

#include <pjsr/utility/ScriptErrors.js>
#include "../FlatSmooth-Core.js"
#include "../FlatSmooth-Strings.js"
#include "../FlatSmooth-Engine.js"
#include "../FlatSmooth-GUI.js"

function dialogTestMain()
{
   const lines = [];
   let failures = 0;
   try
   {
      fsLoadLanguageSetting();
      lines.push( "PASS saved language setting can be read (" + fsLanguage() + ")" );
      FS_LANGUAGES.forEach( language =>
      {
         fsSetLanguage( language );
         const params = new FsParameters;
         const dialog = new FsDialog( params );
         dialog.collect();
         const ok = dialog.windowTitle === FS_TITLE && dialog.relaunch === false &&
                    params.cfaMode === "auto" && params.autoRadius === true &&
                    Math.abs( params.targetPercent - FS_DEFAULT_TARGET_PERCENT ) < 1e-9 && params.fixedRadius === FS_DEFAULT_FIXED_RADIUS;
         lines.push( ( ok ? "PASS" : "FAIL" ) + " dialog builds and collects defaults (" + language + ")" );
         if ( !ok )
            ++failures;
      } );
   }
   catch ( x )
   {
      lines.push( "FAIL " + x.toString() );
      ++failures;
   }
   lines.push( "RESULT: " + ( failures === 0 ? "PASS" : "FAIL" ) );
   File.writeTextFile( File.systemTempDirectory + "/FlatSmooth-dialog.txt", lines.join( "\n" ) + "\n" );
}

dialogTestMain();
