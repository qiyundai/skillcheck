import { readFile, realpath, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ALWAYS_IGNORE, createSnapshot, parseConfig, parseDocument, hash } from '@skillcheck/core';
import type { Snapshot } from '@skillcheck/core';
const exec=promisify(execFile);
export const CONFIG_FILE='skillcheck.config.json';
export async function git(root:string,args:string[]):Promise<string>{const {stdout}=await exec('git',['-C',root,...args],{encoding:'utf8',maxBuffer:64*1024*1024});return stdout;}
export async function gitRoot(root:string):Promise<string>{return (await git(root,['rev-parse','--show-toplevel'])).trim();}
export async function resolveCommit(root:string,ref:string):Promise<string>{return (await git(root,['rev-parse','--verify','--end-of-options',ref+'^{commit}'])).trim();}
export async function mergeBase(root:string,base:string,head:string):Promise<string>{try{return (await git(root,['merge-base',await resolveCommit(root,base),await resolveCommit(root,head)])).trim();}catch{throw new Error('Cannot determine merge-base; fetch full history (actions/checkout fetch-depth: 0) and verify refs.');}}
export type Overlays=ReadonlyMap<string,string>;
async function hydrate(paths:string[],reader:(file:string)=>Promise<string>,origin:string,configPath:string):Promise<Snapshot>{
  const files:Record<string,string>=Object.fromEntries(paths.map(p=>[p,'']));
  const rawConfig=paths.includes(configPath)?await reader(configPath):undefined;
  const config=rawConfig!==undefined?parseConfig(JSON.parse(rawConfig)):parseConfig();
  if(rawConfig!==undefined)files[configPath]=rawConfig;
  // Glob matching on an immutable path manifest keeps Git and filesystem selection identical.
  const {selectedPaths}=await import('@skillcheck/core');
  const selected=selectedPaths(createSnapshot(files,config,origin));const queue=[...new Set([...selected,...config.compositions.flatMap(c=>c.files)])];const loaded=new Set<string>();
  for(let i=0;i<queue.length;i++) {
    const file=queue[i]!;if(loaded.has(file) || !paths.includes(file))continue;loaded.add(file);
    const text=await reader(file);files[file]=text;
    if(/\.md$/i.test(file)) {
      const doc=parseDocument(file,text,'discovery',config);
      for(const ref of doc.references)if(paths.includes(ref.target))queue.push(ref.target);
    }
  }
  return createSnapshot(files,config,origin);
}
export async function filesystemSnapshot(root:string,overlays:Overlays=new Map(),configPath=CONFIG_FILE):Promise<Snapshot>{
  const boundary=await realpath(root);
  const paths:string[]=[];const pending=[''];
  for(let i=0;i<pending.length;i++)for(const entry of await readdir(path.join(boundary,pending[i]!),{withFileTypes:true})) {
    const relative=path.posix.join(pending[i]!,entry.name);
    if(entry.isSymbolicLink() || ['node_modules','.git','dist'].includes(entry.name) || relative==='.skillcheck')continue;
    if(entry.isDirectory())pending.push(relative);else if(entry.isFile())paths.push(relative);
  }
  for(const file of overlays.keys())if(!paths.includes(file))paths.push(file);
  const reader=async(file:string)=>{
    const full=path.resolve(boundary,file);if(full!==boundary && !full.startsWith(boundary+path.sep))throw new Error(`Path outside workspace: ${file}.`);
    const overlay=overlays.get(file);if(overlay!==undefined)return overlay;
    const resolved=await realpath(full);if(!resolved.startsWith(boundary+path.sep))throw new Error(`Symlink outside workspace: ${file}.`);
    const stat=await lstat(full);if(!stat.isFile() || stat.size>2*1024*1024)throw new Error(`Unsupported or oversized instruction/dependency: ${file}.`);
    const bytes=await readFile(full);return /\.md$|\.json$/i.test(file)?bytes.toString('utf8'):`dependency-sha256:${hash(bytes.toString('base64'))}`;
  };
  return hydrate(paths.sort(),reader,overlays.size?'worktree+editor':'worktree',configPath);
}
export async function gitSnapshot(root:string,ref:string,configPath=CONFIG_FILE):Promise<Snapshot>{
  const sha=await resolveCommit(root,ref);const entries=(await git(root,['ls-tree','-r','-z',sha])).split('\0').filter(Boolean);
  const blobs=new Map<string,{mode:string;sha:string}>();
  for(const entry of entries){const tab=entry.indexOf('\t');const [mode,type,object]=entry.slice(0,tab).split(' ');if(type==='blob' && object)blobs.set(entry.slice(tab+1),{mode:mode!,sha:object});}
  return hydrate([...blobs.keys()].sort(),async file=>{const blob=blobs.get(file)!;if(blob.mode==='120000')throw new Error(`Git snapshot symlink cannot be read as an instruction/dependency: ${file}.`);const size=Number((await git(root,['cat-file','-s',blob.sha])).trim());if(size>2*1024*1024)throw new Error(`Oversized instruction/dependency: ${file}.`);const content=await git(root,['cat-file','blob',blob.sha]);return /\.md$|\.json$/i.test(file)?content:`dependency-sha256:${hash(content)}`;},`git:${sha}`,configPath);
}
