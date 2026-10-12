import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { CHANGE_LABELS, CONFLICT_LABELS, parseDocument, sourceSpan, hash, validateResult, classifyWithDeadline } from '@skillcheck/core';
import type { Config, SemanticClassifier, SemanticRequest, InstructionUnit } from '@skillcheck/core';
const rowSchema=z.strictObject({id:z.string(),family:z.string().min(1),split:z.enum(['development','held-out']),task:z.enum(['change','conflict']),texts:z.array(z.string()).length(2),context:z.array(z.string()).default([]),acceptableLabels:z.array(z.string()).min(1)});
export async function evaluate(file:string,classifier:SemanticClassifier,config:Config):Promise<{exitCode:0|2;report:unknown}> {
  const rows=(await readFile(file,'utf8')).split(/\r?\n/).filter(line=>line.trim()).map((line,i)=>{try{return rowSchema.parse(JSON.parse(line));}catch{throw new Error(`Invalid evaluation row ${i+1}.`);}});
  if(!rows.length)throw new Error('Evaluation dataset is empty.');
  const ids=new Set<string>(),families=new Map<string,string>();
  for(const row of rows){if(ids.has(row.id))throw new Error(`Duplicate dataset ID: ${row.id}.`);ids.add(row.id);const split=families.get(row.family);if(split && split!==row.split)throw new Error(`Dataset family crosses development and held-out splits: ${row.family}.`);families.set(row.family,row.split);const labels:readonly string[]=row.task==='change'?CHANGE_LABELS:CONFLICT_LABELS;if(row.acceptableLabels.some(l=>!labels.includes(l)))throw new Error(`Invalid acceptable label: ${row.id}.`);}
  const results:Array<Record<string,unknown>>=[];let correct=0,failed=0,abstained=0,brierSum=0;const confusion:Record<string,Record<string,number>>={};const started=Date.now();
  for(const [index,row] of rows.entries()) {
    const units=row.texts.map((text,i):InstructionUnit=>{
      const span=sourceSpan(`example-${index}-${i}.md`,text,0,text.length);return {text,span,snapshotId:hash(row.id),unitId:hash([row.id,i]),headingPath:[],context:row.context.map((t,j)=>({text:t,span:sourceSpan(`context-${j}.md`,t,0,t.length)})),sourceRole:'instruction',capabilityHints:[],contentFingerprint:hash(text),contextFingerprint:hash(row.context)};
    });
    const request:SemanticRequest={task:row.task,units,composition:{id:row.id,files:units.map(u=>u.span.path),precedence:[],assumptions:[]},rubricVersion:config.semantic.rubricVersion};
    try {if(index>=config.semantic.maxPairsPerRun || Date.now()-started>=config.semantic.maxRunMs)throw new Error('Evaluation request/time budget exhausted.');if(JSON.stringify(request).length>config.semantic.maxRequestChars)throw new Error('Evaluation context exceeds request budget.');
      const signal=AbortSignal.timeout(Math.min(config.semantic.timeoutMs,Math.max(1,config.semantic.maxRunMs-(Date.now()-started))));
      const result=validateResult(request,await classifyWithDeadline(classifier,request,signal));const match=row.acceptableLabels.includes(result.label);correct+=Number(match);abstained+=Number(result.label==='uncertain');
      const truth=row.acceptableLabels.join('|');confusion[truth]??={};confusion[truth]![result.label]=(confusion[truth]![result.label]??0)+1;
      if(row.acceptableLabels.length===1)brierSum+=Object.entries(result.probabilities).reduce((s,[l,p])=>s+(p-Number(l===row.acceptableLabels[0]))**2,0);
      results.push({id:row.id,family:row.family,split:row.split,acceptableLabels:row.acceptableLabels,correct:match,classification:result});
    }catch(error){failed++;results.push({id:row.id,error:error instanceof Error?error.message:String(error)});}
  }
  const singleton=rows.filter(r=>r.acceptableLabels.length===1 && results.find(x=>x.id===r.id)?.classification).length;
  return {exitCode:failed?2:0,report:{version:1,kind:'evaluation',rubricVersion:config.semantic.rubricVersion,examples:rows.length,completed:rows.length-failed,failed,acceptableLabelAccuracy:correct/(rows.length-failed||1),abstentionRate:abstained/(rows.length-failed||1),brierScore:singleton?brierSum/singleton:null,confusion,latencyMs:Date.now()-started,results,note:'Initial fixtures are plumbing checks, not evidence of real-world semantic accuracy. Retrieval and behavior are not measured by this command.'}};
}
