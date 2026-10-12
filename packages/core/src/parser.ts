import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import type { Root, RootContent, Definition } from 'mdast';
import { hash, finding } from './config.js';
import type { Config, Excerpt, InstructionUnit, ParsedDocument, SourceSpan } from './types.js';

type Node = { type: string; depth?: number; value?: string; url?: string; identifier?: string; children?: Node[]; position?: { start: {offset?: number}; end: {offset?: number} } };
export function sourceSpan(file: string, text: string, start: number, end: number): SourceSpan {
  const position = (offset: number) => { const prefix = text.slice(0,offset); const index = prefix.lastIndexOf('\n'); return {line: prefix.split('\n').length-1, character: offset-(index+1)}; };
  const a=position(start), b=position(end);
  return { path:file,startOffset:start,endOffset:end,startLine:a.line,startCharacter:a.character,endLine:b.line,endCharacter:b.character };
}
export function parseDocument(file: string, text: string, snapshotId: string, config: Config): ParsedDocument {
  const ast = unified().use(remarkParse).use(remarkFrontmatter,['yaml']).parse(text) as Root;
  const result: ParsedDocument = { path:file, units:[], references:[], findings:[] };
  const excerpt = (node: Node): Excerpt => {const start=node.position?.start.offset ?? 0,end=node.position?.end.offset ?? start; return {text:text.slice(start,end),span:sourceSpan(file,text,start,end)};};
  const roots = ast.children as Node[]; const headings: Array<{depth:number; excerpt:Excerpt}> = [];
  const definitions = new Map<string,Definition>();
  function collectDefs(node: Node) { if(node.type==='definition') definitions.set((node.identifier ?? '').toLowerCase(),node as Definition); node.children?.forEach(collectDefs); }
  collectDefs(ast as Node);
  const front = roots.find(n => n.type==='yaml');
  if(file.endsWith('SKILL.md')) {
    try { const yaml = front ? parseYaml(front.value ?? '', {uniqueKeys:true}) as unknown : undefined;
      if(!yaml || typeof yaml !== 'object' || !('name' in yaml) || typeof yaml.name !== 'string' || !yaml.name.trim() || !('description' in yaml) || typeof yaml.description !== 'string' || !yaml.description.trim()) result.findings.push(finding('invalid-skill-metadata','SKILL.md requires YAML frontmatter with nonempty name and description.',front ? [excerpt(front)] : [{text:text.slice(0,Math.min(text.length,100)),span:sourceSpan(file,text,0,Math.min(text.length,100))}]));
    } catch { result.findings.push(finding('invalid-skill-metadata','Malformed or duplicate YAML frontmatter keys.',front ? [excerpt(front)] : [])); }
  }
  function reference(node: Node) {
    let url = node.url;
    if(node.type==='linkReference' || node.type==='imageReference') {
      url = definitions.get((node.identifier ?? '').toLowerCase())?.url;
      if(!url) result.findings.push(finding('missing-reference-definition',`Missing Markdown reference definition: ${node.identifier}.`,[excerpt(node)]));
    }
    if(!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return;
    const withoutFragment=url.split(/[?#]/)[0] ?? '';
    if(!withoutFragment) return;
    let decoded: string;
    try { decoded=decodeURIComponent(withoutFragment); } catch { result.findings.push(finding('invalid-reference','Malformed percent-encoded local reference.',[excerpt(node)]));return; }
    const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),decoded));
    if(decoded.startsWith('/') || /\\|^[A-Za-z]:/.test(decoded) || target==='..' || target.startsWith('../')) { result.findings.push(finding('reference-outside-workspace',`Local reference leaves the workspace: ${url}.`,[excerpt(node)]));return; }
    result.references.push({from:file,target,span:excerpt(node).span,url});
  }
  function walkRefs(node: Node) { if(['link','image','linkReference','imageReference'].includes(node.type)) reference(node); node.children?.forEach(walkRefs); }
  walkRefs(ast as Node);
  function unit(node: Node, ancestors: Excerpt[], own?: Excerpt) {
    const raw=own ?? excerpt(node); if(!raw.text.trim()) return;
    const prefix=text.slice(0,raw.span.startOffset); const id=/<!--\s*skillcheck:id\s+([\w.-]+)\s*-->\s*$/.exec(prefix)?.[1];
    const role = node.type==='code' || node.type==='html' ? 'example' : /\b(must|shall|should|never|always|require|do not|don't|may only)\b/i.test(raw.text) ? 'instruction' : 'ambiguous';
    const context=[...(front ? [excerpt(front)] : []),...headings.map(h=>h.excerpt),...ancestors];
    result.units.push({...raw,snapshotId,unitId:hash({snapshotId,file,start:raw.span.startOffset,end:raw.span.endOffset}),...(id ? {authorId:id} : {}),headingPath:headings.map(h=>h.excerpt.text.replace(/^#+\s*/,'')),context,sourceRole:role,capabilityHints:Object.entries(config.capabilities).filter(([,terms])=>terms.some(t=>raw.text.toLowerCase().includes(t.toLowerCase()))).map(([k])=>k),contentFingerprint:hash(raw.text),contextFingerprint:hash(context.map(c=>({text:c.text,path:c.span.path===file?'$self':c.span.path})))});
  }
  function walk(node: Node, ancestors: Excerpt[]) {
    if(node.type==='heading') {const depth=node.depth ?? 1; while(headings.length && headings.at(-1)!.depth>=depth) headings.pop(); headings.push({depth,excerpt:excerpt(node)}); return;}
    if(node.type==='yaml' || node.type==='definition') return;
    if(node.type==='listItem') {
      const children=node.children ?? []; const nestedIndex=children.findIndex(c=>c.type==='list');
      const end=nestedIndex>=0 ? children[nestedIndex]!.position!.start.offset! : node.position!.end.offset!;
      const start=node.position!.start.offset!;
      // Fences remain examples; list prose and its child list are distinct units.
      const prose=children.filter(c=>c.type==='paragraph');
      if(prose.length && children.every(c=>['paragraph','list'].includes(c.type))) {
        const own={text:text.slice(start,end).trimEnd(),span:sourceSpan(file,text,start,start+text.slice(start,end).trimEnd().length)};
        unit(node,ancestors,own);
        children.filter(c=>c.type==='list').forEach(c=>walk(c,[...ancestors,own]));
      } else {
        const parent=prose.map(excerpt);
        children.forEach(c=>walk(c,c.type==='list' ? [...ancestors,...parent] : ancestors));
      }
      return;
    }
    if(['paragraph','code','html'].includes(node.type)) {unit(node,ancestors); return;}
    node.children?.forEach(c=>walk(c,ancestors));
  }
  roots.forEach(node=>walk(node,[]));
  // Retain section siblings, including distant exceptions; bounded requests abstain instead of truncating.
  for(const u of result.units) {
    const siblings=result.units.filter(v=>v.unitId!==u.unitId && v.sourceRole!=='example' && hash(v.headingPath)===hash(u.headingPath)).map(v=>({text:v.text,span:v.span}));
    u.context=[...u.context,...siblings];
    u.contextFingerprint=hash(u.context.map(c=>({path:c.span.path===file?'$self':c.span.path,text:c.text})));
  }
  const ids=new Set<string>(); for(const u of result.units) if(u.authorId) { if(ids.has(u.authorId)) result.findings.push(finding('duplicate-author-id',`Duplicate instruction ID: ${u.authorId}.`,[u])); ids.add(u.authorId); }
  return result;
}
