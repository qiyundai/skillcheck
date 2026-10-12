import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate } from '../packages/cli/src/eval.js';
import { parseConfig } from '@skillcheck/core';
it('enforces evaluation deadlines even for noncooperative providers',async()=>{const directory=await mkdtemp(path.join(tmpdir(),'skillcheck-eval-'));try{const file=path.join(directory,'examples.jsonl');await writeFile(file,JSON.stringify({id:'x',family:'f',split:'development',task:'change',texts:['Always ask.','Sometimes ask.'],context:[],acceptableLabels:['weakened']}));const result=await evaluate(file,{classify:()=>new Promise(()=>{})},parseConfig({semantic:{timeoutMs:10}}));expect(result.exitCode).toBe(2);expect((result.report as {failed:number}).failed).toBe(1);}finally{await rm(directory,{recursive:true,force:true});}});
it('prevents document family leakage into held-out evaluation',async()=>{const directory=await mkdtemp(path.join(tmpdir(),'skillcheck-splits-'));try{const file=path.join(directory,'examples.jsonl');const base={family:'shared-template',task:'change',texts:['Always ask.','Sometimes ask.'],context:[],acceptableLabels:['weakened']};await writeFile(file,[{...base,id:'a',split:'development'},{...base,id:'b',split:'held-out'}].map(x=>JSON.stringify(x)).join('\n'));await expect(evaluate(file,{classify:()=>new Promise(()=>{})},parseConfig())).rejects.toThrow('family crosses');}finally{await rm(directory,{recursive:true,force:true});}});
