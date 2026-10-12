import picomatch from 'picomatch';
import { finding, hash } from './config.js';
import { parseDocument, sourceSpan } from './parser.js';
import type { Analysis, Composition, Finding, Snapshot } from './types.js';

export const ALWAYS_IGNORE = ['**/node_modules/**','**/.git/**','**/dist/**','.skillcheck/**'];
export function selectedPaths(snapshot: Snapshot): string[] {
  const match=picomatch(snapshot.config.include,{dot:true,windows:false,maxLength:2048,ignore:[...ALWAYS_IGNORE,...snapshot.config.exclude]});return Object.keys(snapshot.files).filter(file=>match(file)).sort();
}
export function analyze(snapshot: Snapshot): Analysis {
  const findings: Finding[]=[]; const selected=selectedPaths(snapshot);
  const explicit = snapshot.config.compositions.flatMap(c=>c.files);
  const queue=[...new Set([...selected,...explicit])];
  const documents: Analysis['documents']=[];const dependencies: Record<string,string[]>={};const visited=new Set<string>();
  if(!selected.length && !explicit.length) findings.push(finding('no-instructions','No instruction files match the configured include patterns.',[],'error',false));
  for(let i=0;i<queue.length;i++) {
    const file=queue[i]!;if(visited.has(file)) continue;visited.add(file);
    const text=snapshot.files[file];
    if(text===undefined) {findings.push(finding('missing-composition-file',`Configured instruction file is missing: ${file}.`));continue;}
    const doc=parseDocument(file,text,snapshot.id,snapshot.config); documents.push(doc); findings.push(...doc.findings); dependencies[file]=[];
    for(const ref of doc.references) {
      const directory=Object.keys(snapshot.files).some(p=>p.startsWith(ref.target+'/'));
      if(snapshot.files[ref.target]===undefined && !directory) {findings.push(finding('missing-local-reference',`Missing local reference: ${ref.url} (${ref.target}).`,[{text:ref.url,span:ref.span}]));continue;}
      dependencies[file]!.push(ref.target);
      if(/\.md$/i.test(ref.target) && snapshot.files[ref.target]!==undefined) queue.push(ref.target);
    }
  }
  const state=new Map<string,number>(); const stack:string[]=[];
  function visit(file:string) {
    if(state.get(file)===1) {const cycle=[...stack.slice(stack.indexOf(file)),file]; findings.push(finding('dependency-cycle',`Markdown dependency cycle: ${cycle.join(' → ')}.`,cycle.slice(0,-1).map(p=>({text:snapshot.files[p] ?? '',span:sourceSpan(p,snapshot.files[p] ?? '',0,(snapshot.files[p] ?? '').length)}))));return;}
    if(state.get(file)===2) return; state.set(file,1); stack.push(file);
    for(const target of dependencies[file] ?? []) if(dependencies[target]) visit(target);
    stack.pop();state.set(file,2);
  }
  Object.keys(dependencies).sort().forEach(visit);
  const compositions: Composition[]=structuredClone(snapshot.config.compositions);const compositionIds=new Set<string>();
  for(const composition of compositions) {
    if(compositionIds.has(composition.id)) findings.push(finding('invalid-composition',`Duplicate composition ID: ${composition.id}.`)); compositionIds.add(composition.id);
    if(new Set(composition.files).size!==composition.files.length) findings.push(finding('invalid-composition',`Repeated file in composition: ${composition.id}.`));
    const edges=new Map<string,string[]>();
    for(const edge of composition.precedence) {
      if(!composition.files.includes(edge.higher) || !composition.files.includes(edge.lower)) findings.push(finding('invalid-precedence',`Precedence endpoints must belong to composition ${composition.id}: ${edge.higher} > ${edge.lower}.`));
      edges.set(edge.higher,[...(edges.get(edge.higher) ?? []),edge.lower]);
    }
    const active=new Set<string>(),done=new Set<string>();let cycle=false;
    const walk=(p:string):void=>{if(active.has(p)){cycle=true;return;}if(done.has(p))return;active.add(p);for(const q of edges.get(p) ?? [])walk(q);active.delete(p);done.add(p);};
    composition.files.forEach(walk);
    if(cycle) findings.push(finding('precedence-cycle',`Precedence cycle in composition ${composition.id}.`));
  }
  // Files outside explicit compositions get independent scopes, never a repository-wide inferred composition.
  const covered=new Set(compositions.flatMap(c=>c.files));
  for(const file of selected) if(!covered.has(file)) {
    const id=`file:${file}`;if(compositionIds.has(id)) findings.push(finding('invalid-composition',`Reserved automatic composition ID is already in use: ${id}.`));
    compositions.push({id,files:[file],precedence:[],assumptions:[]});
  }
  // Dependency excerpts affect the caller without assigning runtime authority to them.
  for(const doc of documents) {
    const reachable=new Set<string>();const add=(p:string):void=>{for(const d of dependencies[p] ?? []) if(!reachable.has(d) && d!==doc.path && /\.md$/i.test(d)){reachable.add(d);add(d);}};add(doc.path);
    for(const u of doc.units) {
      for(const target of [...reachable].sort()) if(snapshot.files[target]!==undefined) u.context.push({text:snapshot.files[target]!,span:sourceSpan(target,snapshot.files[target]!,0,snapshot.files[target]!.length)});
      u.contextFingerprint=hash({context:u.context.map(c=>({path:c.span.path===doc.path?'$self':c.span.path,text:c.text})),dependencies:(dependencies[doc.path] ?? []).map(target=>({target,content:hash(snapshot.files[target] ?? '')}))});
    }
  }
  return {snapshot,documents,compositions,findings,dependencies};
}
export function precedes(composition: Composition, higher: string, lower: string): boolean {
  if(higher===lower) return false;const visited=new Set<string>();
  const visit=(p:string):boolean=>{if(visited.has(p))return false;visited.add(p);return composition.precedence.filter(e=>e.higher===p).some(e=>e.lower===lower || visit(e.lower));};
  return visit(higher);
}
