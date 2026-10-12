import { z } from 'zod';
import { finding, hash, canonical } from './config.js';
import { precedes } from './analysis.js';
import { lexicalTerms, similarity } from './matching.js';
import { matchUnits } from './matching.js';
import { ENGINE_VERSION, PARSER_VERSION } from './types.js';
import type { Analysis, AnalysisCache, Composition, Coverage, Finding, InstructionUnit, Report, SemanticClassifier, SemanticRequest, SemanticResult } from './types.js';
export const CHANGE_LABELS=['equivalent','strengthened','weakened','scope_changed','incompatible','mixed','unrelated','uncertain'] as const;
export const CONFLICT_LABELS=['compatible','potential_conflict','scoped_exception','resolved_by_precedence','uncertain'] as const;
const resultSchema=z.object({label:z.string(),probabilities:z.record(z.string(),z.number().min(0).max(1)),providerConfidence:z.number().min(0).max(1).optional(),provider:z.string().min(1),requestedModel:z.string().min(1),resolvedModel:z.string().min(1),rubricVersion:z.string().min(1),usage:z.object({inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative()}).optional()});
export function validateResult(request: SemanticRequest, raw:unknown):SemanticResult {
  const result=resultSchema.parse(raw);const labels:readonly string[]=request.task==='change' ? CHANGE_LABELS:CONFLICT_LABELS;
  if(!labels.includes(result.label) || labels.length!==Object.keys(result.probabilities).length || labels.some(label=>result.probabilities[label]===undefined))throw new Error('Provider returned an incomplete or invalid label distribution.');
  const sum=Object.values(result.probabilities).reduce((a,b)=>a+b,0);if(Math.abs(sum-1)>0.001)throw new Error('Provider probabilities must sum to one.');
  if(result.probabilities[result.label]!+0.000001<Math.max(...Object.values(result.probabilities)))throw new Error('Selected label is not a highest-probability option.');
  if(result.rubricVersion!==request.rubricVersion)throw new Error('Provider rubric version does not match.');return result;
}
export async function classifyWithDeadline(classifier:SemanticClassifier,request:SemanticRequest,signal:AbortSignal):Promise<SemanticResult> {
  signal.throwIfAborted();
  return new Promise<SemanticResult>((resolve,reject)=>{
    const abort=()=>reject(new Error('Provider timeout or cancellation.'));
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>classifier.classify(request,signal)).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export interface CandidateSelection {requests:SemanticRequest[];total:number;omitted:number;scopes:string[]}
export function conflictCandidates(analysis:Analysis):CandidateSelection {
  const requests:SemanticRequest[]=[];let total=0;const scopes:string[]=[];const cfg=analysis.snapshot.config.semantic;
  for(const composition of analysis.compositions) {
    const units=analysis.documents.filter(d=>composition.files.includes(d.path)).flatMap(d=>d.units).filter(u=>u.sourceRole!=='example');
    const count=units.length*(units.length-1)/2;total+=count;let selected=0;
    for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++) {
      const a=units[i]!,b=units[j]!;
      const termsA=lexicalTerms(a.text), termsB=lexicalTerms(b.text);
      const referenced=analysis.dependencies[a.span.path]?.includes(b.span.path) || analysis.dependencies[b.span.path]?.includes(a.span.path);
      // Explicit cross-file policies and all dependency relationships are retained.
      if(units.length<=cfg.exhaustiveLimit || a.span.path!==b.span.path || referenced || a.capabilityHints.some(h=>b.capabilityHints.includes(h)) || [...termsA].some(t=>t.length>3 && termsB.has(t)) || similarity(a.headingPath.join(' '),b.headingPath.join(' '))>0.5) {
        requests.push({task:'conflict',units:[a,b],composition,rubricVersion:cfg.rubricVersion});selected++;
      }
    }
    if(selected<count)scopes.push(composition.id);
  }
  return {requests,total,omitted:total-requests.length,scopes};
}
export function requestKey(request:SemanticRequest,analysis:Analysis):string {
  return hash({task:request.task,units:request.units.map(u=>({path:u.span.path,text:u.text,headingPath:u.headingPath,context:u.context.map(c=>({path:c.span.path,text:c.text})),sourceRole:u.sourceRole,contextFingerprint:u.contextFingerprint})),composition:request.composition,parser: PARSER_VERSION,rubric:request.rubricVersion,provider:analysis.snapshot.config.provider,configuration:analysis.snapshot.config});
}
function semanticFinding(request:SemanticRequest,result:SemanticResult):Finding {
  let label=result.label;
  // The classifier cannot invent authority that the composition does not establish.
  if(request.task==='conflict' && label==='resolved_by_precedence') {
    const a=request.units[0]!,b=request.units[1]!;
    if(!precedes(request.composition,a.span.path,b.span.path) && !precedes(request.composition,b.span.path,a.span.path))label='uncertain';
  }
  const kind=request.task==='change' ? `semantic-${label}` : label==='potential_conflict' ? 'potential-conflict' : `semantic-${label}`;
  const informational=['equivalent','compatible','scoped_exception','resolved_by_precedence'].includes(label);
  const f=finding(kind,request.task==='change' ? `Change classified as ${label}. Review the original before/after passages and their context.` : `Instruction relationship classified as ${label}. Review the quoted rules, scope, and exceptions.`,request.units.map(u=>({text:u.text,span:u.span})),informational?'information':'warning',true,request.composition.id);
  f.contextFingerprint=hash({units:request.units.map(u=>({content:u.contentFingerprint,context:u.contextFingerprint})),composition:request.composition});
  f.fingerprint=hash({kind,context:f.contextFingerprint,composition:request.composition.id,classification:{label:result.label,probabilities:result.probabilities,provider:result.provider,requestedModel:result.requestedModel,resolvedModel:result.resolvedModel,rubricVersion:result.rubricVersion}});
  f.capabilityHints=[...new Set(request.units.flatMap(u=>u.capabilityHints))];
  f.classification=result; if(label!==result.label) f.message+=' The provider proposed precedence without a configured authority relationship; review is required.';
  return f;
}
function emptyCoverage(semantic:boolean):Coverage {return {mode:semantic?'semantic':'deterministic',complete:true,candidatePairs:0,requested:0,completed:0,cacheHits:0,omitted:0,failed:0,affectedScopes:[],transmittedFiles:[],inputTokens:0,outputTokens:0};}
export interface RunOptions {classifier?:SemanticClassifier;cache?:AnalysisCache;semantic?:boolean;signal?:AbortSignal;providerError?:string; budget?:{remaining:number;started:number}}
async function classifyRequests(analysis:Analysis,selection:CandidateSelection,options:RunOptions,coverage:Coverage):Promise<Finding[]> {
  const findings:Finding[]=[]; const config=analysis.snapshot.config;const start=options.budget?.started ?? Date.now();
  coverage.candidatePairs+=selection.total;coverage.omitted+=selection.omitted;coverage.affectedScopes.push(...selection.scopes);
  const max=Math.min(config.semantic.maxPairsPerRun,options.budget?.remaining ?? config.semantic.maxPairsPerRun);const requests=selection.requests.slice(0,max);if(options.budget)options.budget.remaining-=requests.length;
  const capped=selection.requests.slice(max);coverage.omitted+=capped.length;coverage.affectedScopes.push(...capped.map(r=>r.composition.id));
  if(coverage.omitted)findings.push(finding('incomplete-pair-coverage',`${coverage.omitted} candidate comparisons omitted by retrieval or request budget.`,[],'warning',false));
  if(!options.classifier) {coverage.failed+=Math.max(1,requests.length);coverage.complete=false;findings.push(finding('provider-unavailable',options.providerError ?? 'Semantic analysis was requested but no provider is configured.',[],'error',false));return findings;}
  let next=0;
  const worker=async()=>{while(next<requests.length) {
    const request=requests[next++]!;
    if(options.signal?.aborted)throw new Error('Analysis cancelled.');
    if(!options.classifier) {coverage.failed++;findings.push(finding('provider-unavailable','Semantic analysis was requested but no provider is configured.',request.units,'error',false,request.composition.id));continue;}
    if(Date.now()-start>=config.semantic.maxRunMs || canonical(request).length>config.semantic.maxRequestChars) {coverage.omitted++;coverage.affectedScopes.push(request.composition.id);findings.push(finding('incomplete-context-or-budget','The full source and context exceed the request size or run time budget. Nothing was truncated.',request.units,'warning',false,request.composition.id));continue;}
    const key=requestKey(request,analysis);const alias=/latest|preview/.test(config.provider.model);
    try {
      const cached=!alias ? await options.cache?.get(key) : undefined;
      if(cached) {
        const valid=validateResult(request,cached);
        if(valid.requestedModel!==config.provider.model || valid.provider!==config.provider.name)throw new Error('Cached provider metadata does not match the request.');
        coverage.cacheHits++;coverage.completed++;findings.push(semanticFinding(request,valid));continue;
      }
      coverage.requested++;if(config.provider.name==='jev')coverage.transmittedFiles.push(...request.units.flatMap(u=>[u.span.path,...u.context.map(c=>c.span.path)]));
      const timeout=AbortSignal.timeout(Math.max(1,Math.min(config.semantic.timeoutMs,config.semantic.maxRunMs-(Date.now()-start))));
      const signal=options.signal ? AbortSignal.any([options.signal,timeout]):timeout;
      // Enforce the deadline even for an adapter that fails to observe cancellation.
      const result=validateResult(request,await classifyWithDeadline(options.classifier!,request,signal));
      if(result.requestedModel!==config.provider.model || result.provider!==config.provider.name)throw new Error('Provider identity or requested model does not match configuration.');
      if(!alias && result.resolvedModel!==config.provider.model)throw new Error('Provider did not resolve the pinned model requested.');
      coverage.completed++;coverage.inputTokens+=result.usage?.inputTokens ?? 0;coverage.outputTokens+=result.usage?.outputTokens ?? 0;
      findings.push(semanticFinding(request,result)); if(!alias)await options.cache?.set(key,result);
    } catch(error) {if(options.signal?.aborted)throw error;coverage.failed++;findings.push(finding('provider-failure',error instanceof Error ? error.message:'Provider request failed.',request.units,'error',false,request.composition.id));}
  }};
  await Promise.all(Array.from({length:Math.min(config.semantic.maxConcurrency,requests.length)},worker));
  coverage.complete=coverage.failed===0 && coverage.omitted===0;
  coverage.affectedScopes=[...new Set(coverage.affectedScopes)].sort();coverage.transmittedFiles=[...new Set(coverage.transmittedFiles)].sort();
  return findings.sort((a,b)=>a.fingerprint.localeCompare(b.fingerprint));
}
function applyPolicy(report:Report,analysis:Analysis):Report {
  const config=analysis.snapshot.config;
  report.findings=report.findings.map(f=>structuredClone(f));
  for(const f of report.findings) {
    const s=config.suppressions.find(s=>s.fingerprint===f.fingerprint && s.contextFingerprint===f.contextFingerprint && Date.parse(s.expires+'T23:59:59Z')>=Date.now());
    // Coverage and operational failures cannot be suppressed into success.
    if(s && f.complete)f.suppressed=true;
  }
  report.coverage.complete=report.coverage.complete && !report.findings.some(f=>!f.complete && f.status!=='resolved');
  const blocking=report.findings.some(f=>f.status!=='resolved' && !f.suppressed && (f.severity==='error' && f.complete || config.ci.mode==='enforce' && config.policy.blockingKinds.includes(f.kind)));
  report.exitCode=!report.coverage.complete ? 2 : blocking ? 1:0;
  return report;
}
export async function scan(analysis:Analysis,options:RunOptions={}):Promise<Report> {
  const semantic=options.semantic ?? analysis.snapshot.config.semantic.enabled;const coverage=emptyCoverage(semantic);
  const findings=[...analysis.findings];
  if(semantic)findings.push(...await classifyRequests(analysis,conflictCandidates(analysis),options,coverage));
  return applyPolicy({version:1,command:'scan',engineVersion:ENGINE_VERSION,parserVersion:PARSER_VERSION,snapshots:[{id:analysis.snapshot.id,origin:analysis.snapshot.origin,configFingerprint:hash(analysis.snapshot.config)}],findings,coverage,units:analysis.documents.flatMap(d=>d.units),exitCode:0},analysis);
}
export async function diff(before:Analysis,after:Analysis,options:RunOptions={},beforeOptions:RunOptions=options):Promise<Report> {
  const semantic=options.semantic ?? after.snapshot.config.semantic.enabled;
  const budget={remaining:after.snapshot.config.semantic.maxPairsPerRun,started:Date.now()};
  options={...options,budget};beforeOptions={...beforeOptions,budget};
  const base=await scan(before,{...beforeOptions,semantic});const head=await scan(after,{...options,semantic});
  const changes=matchUnits(base.units,head.units);const coverage=emptyCoverage(semantic);
  const changeRequests:SemanticRequest[]=[]; const structural:Finding[]=[];
  for(const change of changes) {
    if(['unchanged','moved'].includes(change.kind))continue;
    const evidence=[...change.before,...change.after];
    structural.push(finding(`instruction-${change.kind}`,`${change.kind==='changed' ? 'Instruction or governing context changed' : `Instruction ${change.kind}`}. Inspect the original evidence.`,evidence,'information'));
    if(semantic && change.kind==='changed') {
      const unit=change.after[0]!;const compositions=after.compositions.filter(c=>c.files.includes(unit.span.path));
      for(const composition of compositions)changeRequests.push({task:'change',units:evidence,composition,rubricVersion:after.snapshot.config.semantic.rubricVersion});
    }
    if(change.kind==='ambiguous')structural.push(finding('uncertain-matching','Alignment is ambiguous or may contain a split/merge; passages are preserved as a group.',evidence,'warning'));
  }
  if(hash(before.snapshot.config)!==hash(after.snapshot.config))structural.push(finding('configuration-changed','Analysis configuration changed; both snapshots were analyzed independently.',[],'information'));
  const directional=semantic ? await classifyRequests(after,{requests:changeRequests,total:changeRequests.length,omitted:0,scopes:[]},options,coverage):[];
  const baseKeys=new Set(base.findings.map(f=>f.fingerprint));const headKeys=new Set(head.findings.map(f=>f.fingerprint));
  const findings:Finding[]=[...head.findings.map(f=>({...f,status:baseKeys.has(f.fingerprint)?'existing' as const:'new' as const})),...structural.map(f=>({...f,status:'new' as const})),...directional.map(f=>({...f,status:'new' as const}))];
  // An incomplete head comparison cannot establish that a semantic finding was resolved.
  for(const f of base.findings)if(!headKeys.has(f.fingerprint) && f.complete && (head.coverage.complete || !f.classification))findings.push({...f,status:'resolved'});
  if(!base.coverage.complete)findings.push(finding('incomplete-baseline','Baseline analysis was incomplete; resolution comparisons are incomplete.',[],'error',false));
  for(const c of [base.coverage,head.coverage]) {for(const k of ['candidatePairs','requested','completed','cacheHits','omitted','failed','inputTokens','outputTokens'] as const)coverage[k]+=c[k];coverage.complete=coverage.complete && c.complete;coverage.affectedScopes.push(...c.affectedScopes);coverage.transmittedFiles.push(...c.transmittedFiles);}
  coverage.affectedScopes=[...new Set(coverage.affectedScopes)].sort();coverage.transmittedFiles=[...new Set(coverage.transmittedFiles)].sort();
  return applyPolicy({version:1,command:'diff',engineVersion:ENGINE_VERSION,parserVersion:PARSER_VERSION,snapshots:[...base.snapshots,...head.snapshots],findings,coverage,units:head.units,changes,exitCode:0},after);
}
