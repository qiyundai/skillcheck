import { createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind, DiagnosticSeverity, type Diagnostic, type InitializeParams, type Connection } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { analyze, scan, finding, ENGINE_VERSION, PARSER_VERSION } from '@skillcheck/core';
import type { Finding, Report, InstructionUnit } from '@skillcheck/core';
import { createClassifier, DiskCache } from '@skillcheck/providers';
import { filesystemSnapshot } from '../../cli/src/snapshots.js';
import { RevisionScheduler } from './scheduler.js';
export { RevisionScheduler } from './scheduler.js';
export function toDiagnostic(finding:Finding):Diagnostic {
  const e=finding.evidence[0];const span=e?.span;
  const range=span?{start:{line:span.startLine,character:span.startCharacter},end:{line:span.endLine,character:span.endCharacter}}:{start:{line:0,character:0},end:{line:0,character:0}};
  return {range,severity:finding.severity==='error'?DiagnosticSeverity.Error:finding.severity==='warning'?DiagnosticSeverity.Warning:DiagnosticSeverity.Information,source:'skillcheck',code:finding.kind,message:finding.message+(finding.classification?`\n${JSON.stringify(finding.classification)}`:''),data:{fingerprint:finding.fingerprint,complete:finding.complete,classification:finding.classification}};
}
export function startServer(connection:Connection=createConnection(ProposedFeatures.all),allowCloudAnalysis=false):void {
  const documents=new TextDocuments(TextDocument);const scheduler=new RevisionScheduler();let root='';const published=new Set<string>();let currentUnits:InstructionUnit[]=[];
  connection.onInitialize((params:InitializeParams)=>{allowCloudAnalysis=allowCloudAnalysis || params.initializationOptions?.allowCloudAnalysis===true;const uri=params.workspaceFolders?.[0]?.uri ?? params.rootUri; if(uri?.startsWith('file:'))root=fileURLToPath(uri);return {capabilities:{textDocumentSync:TextDocumentSyncKind.Incremental,hoverProvider:true,executeCommandProvider:{commands:['skillcheck.recheck']}}};});
  const clear=()=>{currentUnits=[];for(const uri of published)connection.sendDiagnostics({uri,diagnostics:[],...(documents.get(uri)?{version:documents.get(uri)!.version}:{})});published.clear();};
  const publish=(report:Report,revision:number)=>{
    if(!scheduler.current(revision))return;const grouped=new Map<string,Diagnostic[]>();currentUnits=report.units;
    for(const f of report.findings.filter(f=>!f.suppressed)) {
      const uri=pathToFileURL(path.join(root,f.evidence[0]?.span.path??'skillcheck.config.json')).href;const d=toDiagnostic(f);
      if(f.evidence.length>1)d.relatedInformation=f.evidence.slice(1).map(e=>({location:{uri:pathToFileURL(path.join(root,e.span.path)).href,range:{start:{line:e.span.startLine,character:e.span.startCharacter},end:{line:e.span.endLine,character:e.span.endCharacter}}},message:e.text}));
      grouped.set(uri,[...(grouped.get(uri)??[]),d]);
    }
    for(const uri of new Set([...published,...grouped.keys()])) {const doc=documents.get(uri);connection.sendDiagnostics({uri,diagnostics:grouped.get(uri)??[],...(doc?{version:doc.version}:{})});}
    published.clear();for(const uri of grouped.keys())published.add(uri);
    connection.sendNotification('skillcheck/analysisStatus',{revision,mode:report.coverage.mode,complete:report.coverage.complete,coverage:report.coverage});
  };
  const recheck=async()=>{
    const {revision,signal}=scheduler.invalidate();clear();if(!root)return;
    try {
      const overlays=new Map<string,string>();
      for(const document of documents.all())if(document.uri.startsWith('file:')) {const file=fileURLToPath(document.uri);const rel=path.relative(root,file);if(!rel.startsWith('..') && !path.isAbsolute(rel))overlays.set(rel.split(path.sep).join('/'),document.getText());}
      const snapshot=await filesystemSnapshot(root,overlays);if(!scheduler.current(revision))return;
      const analysis=analyze(snapshot);const deterministic=await scan(analysis,{semantic:false,signal});publish(deterministic,revision);
      if(snapshot.config.semantic.enabled && snapshot.config.provider.name==='jev' && !allowCloudAnalysis){connection.sendNotification('skillcheck/analysisStatus',{revision,mode:'semantic',complete:false,cloudAnalysisBlocked:true});}
      if(snapshot.config.semantic.enabled && (snapshot.config.provider.name!=='jev' || allowCloudAnalysis)) {
        connection.sendNotification('skillcheck/analysisStatus',{revision,pending:true});
        scheduler.schedule(revision,async()=>{try {
          let classifier;try{classifier=await createClassifier(snapshot.config,root);}catch{classifier=undefined;}
          const semantic=await scan(analysis,{semantic:true,signal,cache:new DiskCache(path.join(root,'.skillcheck/cache')),...(classifier?{classifier}:{})});publish(semantic,revision);
        }catch(error){if(scheduler.current(revision))connection.console.error(error instanceof Error?error.message:String(error));}});
      }
    } catch(error) {if(scheduler.current(revision)){const message=error instanceof Error?error.message:String(error);connection.console.error(message);publish({version:1,command:'scan',engineVersion:ENGINE_VERSION,parserVersion:PARSER_VERSION,snapshots:[],findings:[finding('operational-failure',message,[],'error',false)],coverage:{mode:'deterministic',complete:false,candidatePairs:0,requested:0,completed:0,cacheHits:0,omitted:0,failed:1,affectedScopes:[],transmittedFiles:[],inputTokens:0,outputTokens:0},units:[],exitCode:2},revision);}}
  };
  documents.onDidChangeContent(()=>void recheck());documents.onDidClose(()=>void recheck());
  connection.onInitialized(()=>void recheck());connection.onDidChangeWatchedFiles(()=>void recheck());connection.onDidChangeConfiguration(()=>void recheck());
  connection.onExecuteCommand(params=>{if(params.command==='skillcheck.recheck')return recheck();return undefined;});
  connection.onHover(params=>{
    const file=params.textDocument.uri.startsWith('file:')?path.relative(root,fileURLToPath(params.textDocument.uri)).split(path.sep).join('/') : '';
    const unit=currentUnits.find(u=>u.span.path===file && (params.position.line>u.span.startLine || params.position.line===u.span.startLine && params.position.character>=u.span.startCharacter) && (params.position.line<u.span.endLine || params.position.line===u.span.endLine && params.position.character<=u.span.endCharacter));
    return unit ? {contents:{kind:'plaintext' as const,value:`Original passage:\n${unit.text}\n\nRole: ${unit.sourceRole}\nContext fingerprint: ${unit.contextFingerprint}\n\nGoverning context:\n${unit.context.map(c=>`${c.span.path}:${c.span.startLine+1}\n${c.text}`).join('\n\n')}`}}:null;
  });
  connection.onShutdown(()=>scheduler.dispose());documents.listen(connection);connection.listen();
}
