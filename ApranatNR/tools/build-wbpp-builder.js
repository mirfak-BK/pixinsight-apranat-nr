"use strict";
// Generates ApranatNR-WBPP-Builder.js: the ApranatNR sources concatenated into
// one file, because WBPP evaluates a pipeline builder as plain code (no PJSR
// preprocessor, so no #include).
//
//    node tools/build-wbpp-builder.js
//
// tests/wbpp.test.js fails when the generated file is out of date.

const fs = require( "fs" );
const path = require( "path" );

const BUILDER_FILE = "ApranatNR-WBPP-Builder.js";
const SOURCES = [
   "ApranatNR-Version.js",
   "ApranatNR-Core.js",
   "ApranatNR-IO.js",
   "ApranatNR-Engine.js",
   "ApranatNR-WBPP.js"
];

const HEADER = [
   "// ----------------------------------------------------------------------------",
   "// ApranatNR-WBPP-Builder.js - WBPP pipeline builder (GENERATED FILE, DO NOT EDIT)",
   "//",
   "// Use: WBPP > Pipeline > Pipeline builder: enable it and select this file.",
   "// Settings: ApranatNR-WBPP-Settings.json in the same folder.",
   "// Generated from " + SOURCES.join( ", " ) + " by",
   "// tools/build-wbpp-builder.js; edit those files and run the tool again.",
   "// ----------------------------------------------------------------------------",
   ""
].join( "\n" );

const ENTRY_POINT = [
   "",
   "// ==== entry point: WBPP evaluates this file with `engine` in scope ====",
   "anrWbppBuilderMain( engine );",
   ""
].join( "\n" );

/**
 * @param {string} root the ApranatNR folder
 * @returns {string} the builder source
 */
function buildWbppBuilder( root )
{
   const parts = SOURCES.map( name =>
   {
      const text = fs.readFileSync( path.join( root, name ), "utf8" );
      if ( /^[ \t]*#/m.test( text ) )
         throw new Error( name + " contains a preprocessor directive, which WBPP cannot evaluate" );
      return "// ==== " + name + " ====\n" + text.trimEnd() + "\n";
   } );
   return HEADER + parts.join( "\n" ) + ENTRY_POINT;
}

module.exports = { buildWbppBuilder, BUILDER_FILE, SOURCES };

if ( require.main === module )
{
   const root = path.join( __dirname, ".." );
   const target = path.join( root, BUILDER_FILE );
   fs.writeFileSync( target, buildWbppBuilder( root ) );
   process.stdout.write( "wrote " + target + "\n" );
}
