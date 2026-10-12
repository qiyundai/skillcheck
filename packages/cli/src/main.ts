import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyze, diff, scan, finding, replayTraces, ENGINE_VERSION, PARSER_VERSION } from '@skillcheck/core';
import type { Report, Snapshot, RunOptions } from '@skillcheck/core';
import { createClassifier, DiskCache } from '@skillcheck/providers';
import { filesystemSnapshot, gitSnapshot, gitRoot, mergeBase } from './snapshots.js';
import { formatReport } from './reporting.js';
import { initialize } from './init.js';
import { evaluate } from './eval.js';
import { startServer } from '@skillcheck/lsp';
const help=`Skillcheck — source-backed checks for agent instructions\n\nUsage:\n  skillcheck init [--root DIR] [--ci] [--skill-directory skills]\n  skillcheck scan [--semantic | --deterministic] [--format terminal|json|markdown]\n  skillcheck diff --base REF [--head REF | --worktree] [--merge-base]\n  skillcheck replay --scenarios FILE --traces FILE [--input DIFF_REPORT]
  skillcheck eval --dataset FILE\n  skillcheck report --input FILE --format markdown\n  skillcheck lsp --stdio\n\nOptions:\n  --root DIR           Repository/workspace boundary (default: current directory)\n  --config FILE        Workspace-relative config (default: skillcheck.config.json)\n  --output FILE        Write a report instead of stdout\n  --baseline FILE      Mark acknowledged identical findings as existing\n  --no-skill           Do not install the helper skill during init\n  --force              Replace generated tool/skill/workflow during init\n\nNo configuration or API key is required for deterministic scan.\nSemantic analysis requires explicit opt-in and configured provider credentials.\nExit: 0 complete/pass, 1 blocking findings, 2 incomplete/operational failure.\n`;
async function output(text:string,file:string|undefined){if(file){await mkdir(path.dirname(path.resolve(file)),{recursive:true});await writeFile(file,text);}else process.stdout.write(text);}
export async function main(argv=process.argv.slice(2)):Promise<number> {
  let values:ReturnType<typeof parseArgs>['values']={};let command='scan';
  try {
    const parsed=parseArgs({args:argv,allowPositionals:true,strict:true,options:{root:{type:'string'},config:{type:'string'},format:{type:'string'},output:{type:'string'},base:{type:'string'},head:{type:'string'},worktree:{type:'boolean'},'merge-base':{type:'boolean'},semantic:{type:'boolean'},deterministic:{type:'boolean'},baseline:{type:'string'},dataset:{type:'string'},scenarios:{type:'string'},traces:{type:'string'},input:{type:'string'},ci:{type:'boolean'},'skill-directory':{type:'string'},'no-skill':{type:'boolean'},force:{type:'boolean'},stdio:{type:'boolean'},help:{type:'boolean',short:'h'},version:{type:'boolean'}}});
    values=parsed.values;command=parsed.positionals[0]??'scan';
    if(parsed.positionals.length>1)throw new Error('Unexpected positional arguments.');
    if(values.help){process.stdout.write(help);return 0;}if(values.version){process.stdout.write(ENGINE_VERSION+'\n');return 0;}
    const root=path.resolve(values.root as string??process.cwd());const format=values.format as string??'terminal';const out=values.output as string|undefined;
    if(values.semantic && values.deterministic)throw new Error('Choose --semantic or --deterministic, not both.');
    const configPath=values.config as string|undefined;
    if(configPath && (path.isAbsolute(configPath) || configPath.split(/[\\/]/).includes('..')))throw new Error('--config must be workspace-relative.');
    if(command==='init'){await output((await initialize(root,{ci:!!values.ci,skillDirectory:values['no-skill']?false:values['skill-directory'] as string??'.agents/skills',force:!!values.force})).join('\n')+'\n',out);return 0;}
    if(command==='lsp'){if(!values.stdio)throw new Error('Use lsp --stdio.');startServer(undefined,!!values.semantic);return 0;}
    if(command==='report'){if(!values.input)throw new Error('report requires --input.');const report=JSON.parse(await readFile(values.input as string,'utf8')) as Report;if(report.version!==1 || !report.coverage || !Array.isArray(report.findings))throw new Error('Invalid Skillcheck report.');await output(formatReport(report,format),out);return 0;}
    if(command==='replay'){if(!values.scenarios || !values.traces)throw new Error('replay requires --scenarios and --traces.');let changedPaths:string[]|undefined;if(values.input){const diffReport=JSON.parse(await readFile(path.resolve(root,values.input as string),'utf8')) as Report;if(diffReport.command!=='diff' || !Array.isArray(diffReport.changes))throw new Error('--input requires a diff report with changes.');changedPaths=[...new Set(diffReport.changes.filter(c=>!['unchanged','moved'].includes(c.kind)).flatMap(c=>[...c.before,...c.after].map(u=>u.span.path)))];}const result=replayTraces(JSON.parse(await readFile(path.resolve(root,values.scenarios as string),'utf8')),JSON.parse(await readFile(path.resolve(root,values.traces as string),'utf8')),changedPaths);await output(JSON.stringify(result,null,2)+'\n',out);return result.exitCode;}
    if(!['scan','diff','eval'].includes(command))throw new Error(`Unknown command: ${command}.`);
    const workspace=command==='diff'?await gitRoot(root):root;
    const head:Snapshot=command==='diff' && !values.worktree ? await gitSnapshot(workspace,values.head as string??'HEAD',configPath):await filesystemSnapshot(workspace,new Map(),configPath);
    const requested=values.semantic ? true:values.deterministic ? false:head.config.semantic.enabled;
    const cache=new DiskCache(path.join(workspace,'.skillcheck/cache'));
    async function options(snapshot:Snapshot):Promise<RunOptions> {if(!requested)return {semantic:false,cache};try{return {semantic:true,cache,classifier:await createClassifier(snapshot.config,workspace)};}catch(error){return {semantic:true,cache,providerError:error instanceof Error?error.message:String(error)};}}
    if(command==='eval'){
      if(!values.dataset)throw new Error('eval requires --dataset.');const classifier=await createClassifier(head.config,workspace);const result=await evaluate(path.resolve(root,values.dataset as string),classifier,head.config);await output(JSON.stringify(result.report,null,2)+'\n',out);return result.exitCode;
    }
    let report:Report;
    if(command==='scan')report=await scan(analyze(head),await options(head));
    else {
      if(!values.base)throw new Error('diff requires --base.');if(values.worktree && values.head)throw new Error('Choose --head or --worktree, not both.');
      const base=values['merge-base']?await mergeBase(workspace,values.base as string,values.head as string??'HEAD'):values.base as string;
      const before=await gitSnapshot(workspace,base,configPath);report=await diff(analyze(before),analyze(head),await options(head),await options(before));
    }
    if(values.baseline){const raw=JSON.parse(await readFile(path.resolve(root,values.baseline as string),'utf8')) as {findings?:Array<{fingerprint:string}>};if(!Array.isArray(raw.findings))throw new Error('Baseline must be a Skillcheck JSON report.');const keys=new Set(raw.findings.map(f=>f.fingerprint));for(const f of report.findings)if(f.status!=='resolved' && keys.has(f.fingerprint))f.status='existing';}
    await output(formatReport(report,format),out);return report.exitCode;
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    const report:Report={version:1,command:command==='diff'?'diff':'scan',engineVersion:ENGINE_VERSION,parserVersion:PARSER_VERSION,snapshots:[],findings:[finding('operational-failure',message,[],'error',false)],coverage:{mode:values.semantic?'semantic':'deterministic',complete:false,candidatePairs:0,requested:0,completed:0,cacheHits:0,omitted:0,failed:1,affectedScopes:[],transmittedFiles:[],inputTokens:0,outputTokens:0},units:[],exitCode:2};
    try{await output(formatReport(report,values.format as string??'terminal'),values.output as string|undefined);}catch{process.stderr.write(`Skillcheck: ${message}\n`);}return 2;
  }
}
