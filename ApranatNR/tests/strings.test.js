"use strict";

const test = require( "node:test" );
const assert = require( "node:assert/strict" );
const strings = require( "../ApranatNR-Strings.js" );

const fs = require( "node:fs" );
const path = require( "node:path" );
const specifiers = s => ( s.match( /%[-+0-9.]*[sdfg]/g ) || [] );

test( "every message exists in English and Japanese", () =>
{
   const en = Object.keys( strings.ANR_STRINGS.en ).sort();
   const ja = Object.keys( strings.ANR_STRINGS.ja ).sort();
   assert.deepEqual( ja, en );
   for ( const key of en )
   {
      assert.ok( strings.ANR_STRINGS.en[ key ].length > 0, "empty en " + key );
      assert.ok( strings.ANR_STRINGS.ja[ key ].length > 0, "empty ja " + key );
   }
} );

test( "both languages use the same format specifiers in the same order", () =>
{
   for ( const key of Object.keys( strings.ANR_STRINGS.en ) )
      assert.deepEqual( specifiers( strings.ANR_STRINGS.ja[ key ] ), specifiers( strings.ANR_STRINGS.en[ key ] ), key );
} );

test( "English messages contain no Japanese characters", () =>
{
   for ( const [ key, text ] of Object.entries( strings.ANR_STRINGS.en ) )
      assert.ok( !/[぀-ヿ一-鿿]/.test( text ), key );
} );

test( "every message key used by the dialog exists in the tables", () =>
{
   const gui = fs.readFileSync( path.join( __dirname, "..", "ApranatNR-GUI.js" ), "utf8" );
   const used = [ ...gui.matchAll( /anrText\( "([^"]+)" \)/g ) ].map( m => m[ 1 ] );
   const labels = gui.match( /ANR_LABEL_KEYS = \[([^\]]+)\]/ )[ 1 ].match( /"([^"]+)"/g ).map( k => k.slice( 1, -1 ) );
   assert.ok( used.length > 30, "found " + used.length + " uses" );
   for ( const key of used.concat( labels ) )
      assert.ok( key in strings.ANR_STRINGS.en, "missing message " + key );
} );

test( "anrText follows the selected language and falls back to English", () =>
{
   assert.equal( strings.anrLanguage(), "en", "English by default" );
   assert.equal( strings.anrText( "close" ), strings.ANR_STRINGS.en.close );
   assert.equal( strings.anrSetLanguage( "ja" ), true );
   assert.equal( strings.anrText( "close" ), strings.ANR_STRINGS.ja.close );
   assert.equal( strings.anrSetLanguage( "xx" ), false, "unknown languages are refused" );
   assert.equal( strings.anrLanguage(), "ja" );
   assert.equal( strings.anrText( "no-such-key" ), "no-such-key" );
   strings.anrSetLanguage( "en" );
} );
