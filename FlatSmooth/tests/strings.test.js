"use strict";

const test = require( "node:test" );
const assert = require( "node:assert/strict" );
const fs = require( "node:fs" );
const path = require( "node:path" );
const strings = require( "../FlatSmooth-Strings.js" );

const specifiers = s => ( s.match( /%[-+0-9.]*[sdfg]/g ) || [] );

test( "every message exists in English and Japanese with the same format specifiers", () =>
{
   const en = Object.keys( strings.FS_STRINGS.en ).sort();
   assert.deepEqual( Object.keys( strings.FS_STRINGS.ja ).sort(), en );
   for ( const key of en )
   {
      assert.ok( strings.FS_STRINGS.en[ key ].length > 0 && strings.FS_STRINGS.ja[ key ].length > 0, key );
      assert.deepEqual( specifiers( strings.FS_STRINGS.ja[ key ] ), specifiers( strings.FS_STRINGS.en[ key ] ), key );
   }
} );

test( "every message key used by the dialog and engine exists, and every message is used", () =>
{
   const used = new Set();
   for ( const f of [ "FlatSmooth-GUI.js", "FlatSmooth-Engine.js" ] )
   {
      const text = fs.readFileSync( path.join( __dirname, "..", f ), "utf8" );
      [ ...text.matchAll( /fsMsg\( "([^"]+)" \)/g ) ].forEach( m => used.add( m[ 1 ] ) );
      for ( const list of text.matchAll( /FS_(?:LABEL|CFA)_KEYS = \[([^\]]+)\]/g ) )
         list[ 1 ].match( /"([^"]+)"/g ).forEach( k => used.add( k.slice( 1, -1 ) ) );
   }
   for ( const key of used )
      assert.ok( key in strings.FS_STRINGS.en, "missing message " + key );
   for ( const key of Object.keys( strings.FS_STRINGS.en ) )
      assert.ok( used.has( key ), "unused message " + key );
} );

test( "English messages contain no Japanese characters", () =>
{
   for ( const [ key, text ] of Object.entries( strings.FS_STRINGS.en ) )
      assert.ok( !/[぀-ヿ一-鿿]/.test( text ), key );
} );

test( "fsMsg follows the selected language and falls back to English", () =>
{
   assert.equal( strings.fsLanguage(), "en" );
   assert.equal( strings.fsSetLanguage( "ja" ), true );
   assert.equal( strings.fsMsg( "close" ), strings.FS_STRINGS.ja.close );
   assert.equal( strings.fsSetLanguage( "fr" ), false );
   assert.equal( strings.fsMsg( "missing-key" ), "missing-key" );
   strings.fsSetLanguage( "en" );
   assert.equal( strings.fsMsg( "close" ), strings.FS_STRINGS.en.close );
} );
