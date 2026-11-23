// ----------------------------------------------------------------------------
// DarkPixelPlot-DialogTest.js - builds the dialog in every language in a
// headless PixInsight instance. Writes <system temp>/DarkPixelPlot-dialog.txt
// N.B. never write a slash followed by an asterisk in a line comment.
// ----------------------------------------------------------------------------

#engine v8

#include <pjsr/utility/ScriptErrors.js>
#include "../DarkPixelPlot-Core.js"
#include "../DarkPixelPlot-Strings.js"
#include "../DarkPixelPlot-Engine.js"
#include "../DarkPixelPlot-Render.js"
#include "../DarkPixelPlot-GUI.js"

function dialogTestMain()
{
   const lines = [];
   let failures = 0;
   try
   {
      // read the saved language like the script does at start (read only)
      dppLoadLanguageSetting();
      lines.push( "PASS saved language setting can be read (" + dppLanguage() + ")" );
      DPP_LANGUAGES.forEach( language =>
      {
         dppSetLanguage( language );
         const dialog = new DppDialog( new DppParameters );
         const ok = dialog.windowTitle === DPP_TITLE && dialog.relaunch === false;
         lines.push( ( ok ? "PASS" : "FAIL" ) + " dialog builds (" + language + "), font " + dppFontFamily( language, CoreApplication.platform ) );
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
   File.writeTextFile( File.systemTempDirectory + "/DarkPixelPlot-dialog.txt", lines.join( "\n" ) + "\n" );
}

dialogTestMain();
