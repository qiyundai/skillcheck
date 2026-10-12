import { build } from 'esbuild';
import { mkdir, chmod, copyFile, cp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const cli=await build({entryPoints:['packages/cli/src/bin.ts'],outfile:'packages/cli/dist/skillcheck.mjs',bundle:true,loader:{'.md':'text'},platform:'node',target:'node22',format:'esm',banner:{js:"#!/usr/bin/env node\nimport { createRequire as __skillcheckRequire } from 'node:module'; const require = __skillcheckRequire(import.meta.url);"},sourcemap:true,metafile:true});
await chmod('packages/cli/dist/skillcheck.mjs',0o755);
const extension=await build({entryPoints:['packages/vscode/src/extension.ts'],outfile:'packages/vscode/dist/extension.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',external:['vscode'],metafile:true});
const notices=[await readFile('LICENSE','utf8')];const seen=new Set();
for(const file of [...Object.keys(cli.metafile.inputs),...Object.keys(extension.metafile.inputs)].filter(p=>p.includes('node_modules/'))) {
  let directory=path.dirname(path.resolve(file));
  while(directory!==path.dirname(directory)) {
    try {
      const info=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
      if(info.name && info.version){const key=info.name+'@'+info.version;if(!seen.has(key)){seen.add(key);notices.push(`\n===== ${key} (${info.license??'see license'}) =====\n`);const licenses=(await readdir(directory)).filter(name=>/^licen[cs]e(?:\.|$)|^copying(?:\.|$)/i.test(name));if(!licenses.length){if(key==='format@0.2.2')notices.push(await readFile('docs/licenses/format.txt','utf8'));else throw new Error(`Missing distribution license for ${key}`);}for(const license of licenses)notices.push(await readFile(path.join(directory,license),'utf8'));}break;}
    }catch(error){if(error.code!=='ENOENT')throw error;}
    directory=path.dirname(directory);
  }
}
await writeFile('packages/cli/dist/THIRD_PARTY_NOTICES.txt',notices.join('\n'));
await copyFile('packages/cli/dist/skillcheck.mjs','packages/vscode/dist/skillcheck.mjs');
await copyFile('packages/cli/dist/THIRD_PARTY_NOTICES.txt','packages/vscode/dist/THIRD_PARTY_NOTICES.txt');
await mkdir('packages/vscode/assets',{recursive:true});
await cp('packages/cli/assets/skillcheck','packages/vscode/assets/skillcheck',{recursive:true});
