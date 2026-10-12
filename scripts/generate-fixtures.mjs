import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const file=path.resolve('.skillcheck/generate-fixtures.mjs');
await build({entryPoints:['scripts/generate-fixtures.ts'],outfile:file,bundle:true,platform:'node',format:'esm',banner:{js:"import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);"}});
await import(pathToFileURL(file).href);
