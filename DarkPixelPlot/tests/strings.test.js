"use strict";

const test = require( "node:test" );
const assert = require( "node:assert/strict" );
const strings = require( "../DarkPixelPlot-Strings.js" );

const fs = require( "node:fs" );
const path = require( "node:path" );
const specifiers = s => ( s.match( /%[-+0-9.]*[sdfg]/g ) || [] );

test( "every message exists in English and Japanese with the same format specifiers", () =>
{
   const en = Object.keys( strings.DPP_STRINGS.en ).sort();
   assert.deepEqual( Object.keys( strings.DPP_STRINGS.ja ).sort(), en );
   for ( const key of en )
   {
      assert.ok( strings.DPP_STRINGS.en[ key ].length > 0 && strings.DPP_STRINGS.ja[ key ].length > 0, key );
      assert.deepEqual( specifiers( strings.DPP_STRINGS.ja[ key ] ), specifiers( strings.DPP_STRINGS.en[ key ] ), key );
   }
} );

test( "every message key used by the dialog, engine and plot exists in the tables", () =>
{
   const files = [ "DarkPixelPlot-GUI.js", "DarkPixelPlot-Engine.js", "DarkPixelPlot-Render.js" ];
   const used = [];
   for ( const f of files )
   {
      const text = fs.readFileSync( path.join( __dirname, "..", f ), "utf8" );
      used.push( ...[ ...text.matchAll( /dppMsg\( "([^"]+)" \)/g ) ].map( m => m[ 1 ] ) );
      const labels = text.match( /DPP_LABEL_KEYS = \[([^\]]+)\]/ );
      if ( labels )
         used.push( ...labels[ 1 ].match( /"([^"]+)"/g ).map( k => k.slice( 1, -1 ) ) );
   }
   used.push( "yLabel", "yLabelApranat" );   // picked by a condition in the plot code
   assert.ok( used.length > 30, "found " + used.length + " uses" );
   for ( const key of used )
      assert.ok( key in strings.DPP_STRINGS.en, "missing message " + key );
} );

test( "English messages contain no Japanese characters", () =>
{
   for ( const [ key, text ] of Object.entries( strings.DPP_STRINGS.en ) )
      assert.ok( !/[぀-ヿ一-鿿]/.test( text ), key );
} );

test( "dppMsg follows the selected language and falls back to English", () =>
{
   assert.equal( strings.dppLanguage(), "en" );
   assert.equal( strings.dppSetLanguage( "ja" ), true );
   assert.equal( strings.dppMsg( "close" ), strings.DPP_STRINGS.ja.close );
   assert.equal( strings.dppSetLanguage( "fr" ), false );
   assert.equal( strings.dppMsg( "missing-key" ), "missing-key" );
   strings.dppSetLanguage( "en" );
   assert.equal( strings.dppMsg( "close" ), strings.DPP_STRINGS.en.close );
} );

test( "fontFamily picks a font with Japanese glyphs for Japanese on every platform", () =>
{
   assert.equal( strings.dppFontFamily( "ja", "macOS" ), "Hiragino Sans" );
   assert.equal( strings.dppFontFamily( "ja", "MSWINDOWS" ), "Yu Gothic UI" );
   assert.equal( strings.dppFontFamily( "ja", "Linux" ), "Noto Sans CJK JP" );
   assert.equal( strings.dppFontFamily( "en", "MacOSX" ), "Helvetica Neue" );
   assert.equal( strings.dppFontFamily( "en", "MSWINDOWS" ), "Segoe UI" );
   assert.equal( strings.dppFontFamily( "en", "FreeBSD" ), "DejaVu Sans" );
} );
