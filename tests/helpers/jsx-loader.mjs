// Use the project's existing Next compiler; no extra test-only transpiler dependency.
import {registerHooks} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import babel from 'next/dist/compiled/babel/core.js';
registerHooks({
 resolve(specifier,context,next){
  if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/i.test(specifier)){
   const base=new URL(specifier,context.parentURL);
   for(const ext of ['.js','.jsx'])if(existsSync(fileURLToPath(base)+ext))return next(specifier+ext,context);
  }
  return next(specifier,context);
 },
 load(url,context,next){
  if(!url.endsWith('.jsx'))return next(url,context);
  const source=babel.transformSync(readFileSync(new URL(url),'utf8'),{filename:fileURLToPath(url),caller:{name:'babel-loader',isServer:true,supportsStaticESM:true},presets:[['next/babel',{'preset-env':{modules:false,targets:{node:'current'}},'preset-react':{runtime:'automatic'}}]],babelrc:false,configFile:false}).code;
  return {format:'module',source,shortCircuit:true};
 }
});
