import { describe, it, expect, vi } from 'vitest';
import { RevisionScheduler, toDiagnostic } from '@skillcheck/lsp';
import { finding, sourceSpan, replayTraces } from '@skillcheck/core';
import { readFile } from 'node:fs/promises';
describe('editor scheduling',()=>{
  it('cancels old revisions and discards results even if cancellation was ignored',()=>{const scheduler=new RevisionScheduler();const old=scheduler.invalidate(),next=scheduler.invalidate();expect(old.signal.aborted).toBe(true);expect(scheduler.current(old.revision)).toBe(false);expect(scheduler.current(next.revision)).toBe(true);scheduler.dispose();});
  it('only runs the latest debounce request',async()=>{vi.useFakeTimers();try{const scheduler=new RevisionScheduler();let calls=0;const a=scheduler.invalidate();scheduler.schedule(a.revision,async()=>{calls++;});const b=scheduler.invalidate();scheduler.schedule(b.revision,async()=>{calls+=10;});await vi.advanceTimersByTimeAsync(800);expect(calls).toBe(10);scheduler.dispose();}finally{vi.useRealTimers();}});
  it('uses exact UTF-16 locations in diagnostics',()=>{const text='🐈 must be preserved.\nNever delete.';const span=sourceSpan('SKILL.md',text,22,text.length);const d=toDiagnostic(finding('issue','review',[{text:'Never delete.',span}]));expect(d.range.start).toEqual({line:1,character:0});});
});
describe('recorded behavioral bridge',()=>{
  it('checks mock authorization traces without performing tool actions',async()=>{const scenarios=JSON.parse(await readFile('fixtures/semantic/scenarios.json','utf8')),traces=JSON.parse(await readFile('fixtures/semantic/traces.json','utf8'));expect(replayTraces(scenarios,traces).exitCode).toBe(0);traces[0].calls[0].authorized=false;const report=replayTraces(scenarios,traces);expect(report.exitCode).toBe(1);expect(report.results[0]!.runs[0]!.failures[0]).toContain('unauthorized');expect(report.results[0]!.interval95).not.toEqual([1,1]);});
  it('exposes absent traces and absent instruction mappings',async()=>{const scenarios=JSON.parse(await readFile('fixtures/semantic/scenarios.json','utf8'));expect(replayTraces(scenarios,[]).exitCode).toBe(2);const report=replayTraces(scenarios,[],['new/SKILL.md']);expect(report.missingMappings).toEqual(['new/SKILL.md']);expect(report.exitCode).toBe(2);});
});
