import { writeFile } from 'node:fs/promises';
import { hash, sourceSpan } from '@skillcheck/core';
import type { InstructionUnit, SemanticRequest } from '@skillcheck/core';
import { oneHot, recordingFingerprint } from '@skillcheck/providers';
// Synthetic recordings validate transport/evaluation mechanics, not model quality.
const rows=[
  {id:'approval-weakened',family:'authorization',split:'development',task:'change',texts:['You must ask before deletion.','You may ask before deletion.'],context:[],acceptableLabels:['weakened']},
  {id:'approval-strengthened',family:'authorization',split:'development',task:'change',texts:['You should ask before deletion.','You must ask before deletion.'],context:[],acceptableLabels:['strengthened']},
  {id:'paraphrase',family:'authorization',split:'development',task:'change',texts:['Never delete without approval.','Deletion always requires approval.'],context:[],acceptableLabels:['equivalent']},
  {id:'scope-narrowed',family:'scope',split:'development',task:'change',texts:['Ask before deleting files.','Ask before deleting production files.'],context:[],acceptableLabels:['scope_changed']},
  {id:'mixed-duty-and-scope',family:'scope',split:'development',task:'change',texts:['You should ask before deleting files.','You must ask before deleting production files.'],context:[],acceptableLabels:['mixed']},
  {id:'negated',family:'negation',split:'development',task:'change',texts:['You must send the message.','You must not send the message.'],context:[],acceptableLabels:['incompatible']},
  {id:'unrelated',family:'different-tools',split:'development',task:'change',texts:['Run unit tests.','Keep database backups.'],context:[],acceptableLabels:['unrelated']},
  {id:'ambiguous',family:'implicit-scope',split:'development',task:'change',texts:['Follow the usual approval rules.','Do what is appropriate.'],context:[],acceptableLabels:['uncertain']},
  {id:'conflict',family:'message-policy',split:'development',task:'conflict',texts:['Always send the summary to Slack.','Never send external messages.'],context:[],acceptableLabels:['potential_conflict']},
  {id:'exception',family:'message-policy',split:'development',task:'conflict',texts:['Never send external messages unless explicitly requested.','Send the summary when the user explicitly requests it.'],context:[],acceptableLabels:['scoped_exception']},
  {id:'compatible-tools',family:'different-tools',split:'development',task:'conflict',texts:['Run unit tests.','Keep database backups.'],context:[],acceptableLabels:['compatible']},
  {id:'unknown-scope',family:'implicit-scope',split:'development',task:'conflict',texts:['Always follow local practice.','Use the agreed procedure.'],context:[],acceptableLabels:['uncertain']},
  {id:'translation',family:'multilingual',split:'held-out',task:'change',texts:['删除文件前必须请求许可。','You must request permission before deleting files.'],context:[],acceptableLabels:['equivalent','uncertain']},
  {id:'finance-scope',family:'financial-policy',split:'held-out',task:'change',texts:['Ask before every payment.','Ask before payments above $100.'],context:[],acceptableLabels:['scope_changed']},
  {id:'credential-obligation',family:'credential-policy',split:'held-out',task:'change',texts:['Never expose credentials in logs.','Avoid exposing credentials in logs.'],context:[],acceptableLabels:['weakened']},
  {id:'contextual-exception',family:'temporary-files',split:'held-out',task:'conflict',texts:['Never delete files.','Remove the task temporary file.'],context:['Exception: temporary files created by this task may be removed.'],acceptableLabels:['scoped_exception','uncertain']},
] as const;
await writeFile('fixtures/semantic/examples.jsonl',rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
const recordings=rows.map((row,index)=>{
  const units:InstructionUnit[]=row.texts.map((text,i)=>({text,span:sourceSpan(`example-${index}-${i}.md`,text,0,text.length),snapshotId:hash(row.id),unitId:hash([row.id,i]),headingPath:[],context:row.context.map((text,j)=>({text,span:sourceSpan(`context-${j}.md`,text,0,text.length)})),sourceRole:'instruction',capabilityHints:[],contentFingerprint:hash(text),contextFingerprint:hash(row.context)}));
  const request:SemanticRequest={task:row.task,units,composition:{id:row.id,files:units.map(u=>u.span.path),precedence:[],assumptions:[]},rubricVersion:'skillcheck-relations/1'};
  return {requestFingerprint:recordingFingerprint(request),result:oneHot(row.task,row.acceptableLabels[0])};
});
await writeFile('fixtures/semantic/recordings.json',JSON.stringify(recordings,null,2)+'\n');
await writeFile('fixtures/semantic/recorded.config.json',JSON.stringify({version:1,provider:{name:'recorded',model:'recorded-v1',recordings:'fixtures/semantic/recordings.json'},semantic:{enabled:true}},null,2)+'\n');
