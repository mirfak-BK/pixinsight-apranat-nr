// ----------------------------------------------------------------------------
// PixInsight JavaScript Runtime API - PJSR Version 2.0
// ----------------------------------------------------------------------------
// ApranatNR.js
//
// Preprocessing noise countermeasures devised by "あぷらなーと" that are not
// available in WBPP:
//   - Cool file correction (クールファイル補正法)
//       https://apranat.exblog.jp/28135658/
//   - Cosmicut composite (コスミカット法)
//       https://apranat.exblog.jp/31257871/
//   - Software pixel mapping of two-level "drunk" pixels (酩酊ピクセル)
//       https://apranat.exblog.jp/32142709/
// ----------------------------------------------------------------------------

#engine v8

#feature-id    ApranatNR : Preprocessing > ApranatNR

#feature-info  Noise countermeasures by apranat (not available in WBPP):<br/>\
               Stage 1 (before registration): RTN ("drunk") pixel mapping and \
               cool file correction.<br/>\
               Stage 2 (after registration): Cosmicut composite \
               (sum - max) / (n - 1).

CoreApplication.ensureMinimumVersion( 1, 9, 6 );

#include <pjsr/utility/ScriptErrors.js>

#include "ApranatNR-Version.js"
#include "ApranatNR-Core.js"
#include "ApranatNR-IO.js"
#include "ApranatNR-Engine.js"
#include "ApranatNR-Strings.js"
#include "ApranatNR-GUI.js"

function main()
{
   Runtime.jsScriptInformation = ANR_TITLE + " " + ANR_VERSION;
   console.hide();
   try
   {
      anrLoadLanguageSetting();
      const params = new AnrParameters;
      // a language change closes the dialog and builds it again with the same parameters
      for ( ;; )
      {
         const dialog = new AnrDialog( params );
         dialog.execute();
         if ( !dialog.relaunch )
            break;
      }
   }
   catch ( x )
   {
      ScriptErrors.report( x, true/*interactive*/, ANR_TITLE );
   }
}

main();
