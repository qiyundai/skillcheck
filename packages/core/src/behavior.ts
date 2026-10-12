import { z } from 'zod';
/** Trace replay validates recorded observations; it never executes agent tools. */
export const scenarioSchema=z.strictObject({
  id:z.string().min(1),compositionId:z.string().min(1),instructionPaths:z.array(z.string()).min(1),
  taskInput:z.string(),mockEnvironment:z.record(z.string(),z.unknown()),
  assertions:z.array(z.strictObject({tool:z.string().min(1),minCalls:z.number().int().nonnegative().default(0),maxCalls:z.number().int().nonnegative().optional(),requiresAuthorization:z.boolean().default(false)})).min(1),
});
export const traceSchema=z.strictObject({scenarioId:z.string(),runId:z.string(),harnessVersion:z.string().min(1),executionModel:z.string().min(1),calls:z.array(z.strictObject({tool:z.string(),arguments:z.record(z.string(),z.unknown()),authorized:z.boolean()}))});
export type Scenario=z.infer<typeof scenarioSchema>;
export type Trace=z.infer<typeof traceSchema>;
export interface BehaviorHarness { readonly version:string; run(scenario:Scenario,signal?:AbortSignal):Promise<Trace> }
export function replayTraces(scenarioInput:unknown,traceInput:unknown,changedPaths?:string[]) {
  const scenarios=z.array(scenarioSchema).parse(scenarioInput),traces=z.array(traceSchema).parse(traceInput);
  if(new Set(scenarios.map(s=>s.id)).size!==scenarios.length)throw new Error('Scenario IDs must be unique.');
  if(new Set(traces.map(t=>t.scenarioId+':'+t.runId)).size!==traces.length)throw new Error('Trace run IDs must be unique per scenario.');
  if(traces.some(t=>!scenarios.some(s=>s.id===t.scenarioId)))throw new Error('Trace refers to an unknown scenario.');
  const selected=changedPaths?scenarios.filter(s=>s.instructionPaths.some(p=>changedPaths.includes(p))):scenarios;
  const missingMappings=changedPaths?.filter(p=>!scenarios.some(s=>s.instructionPaths.includes(p))) ?? [];
  const results=selected.map(s=>{
    const runs=traces.filter(t=>t.scenarioId===s.id).map(t=>{
      const failures:string[]=[];
      for(const assertion of s.assertions) {
        const calls=t.calls.filter(c=>c.tool===assertion.tool);
        if(calls.length<assertion.minCalls)failures.push(`${assertion.tool}: expected at least ${assertion.minCalls} calls, observed ${calls.length}.`);
        if(assertion.maxCalls!==undefined && calls.length>assertion.maxCalls)failures.push(`${assertion.tool}: expected at most ${assertion.maxCalls} calls, observed ${calls.length}.`);
        if(assertion.requiresAuthorization && calls.some(c=>!c.authorized))failures.push(`${assertion.tool}: recorded an unauthorized call.`);
      }
      return {runId:t.runId,harnessVersion:t.harnessVersion,executionModel:t.executionModel,passed:failures.length===0,failures};
    });
    const passed=runs.filter(r=>r.passed).length,n=runs.length;
    // Wilson 95% interval shows sampling uncertainty; it is not a proof about future behavior.
    const z95=1.96,p=passed/(n||1),denominator=1+z95*z95/(n||1),center=(p+z95*z95/(2*(n||1)))/denominator,margin=z95*Math.sqrt(p*(1-p)/(n||1)+z95*z95/(4*(n||1)**2))/denominator;
    return {scenarioId:s.id,compositionId:s.compositionId,runs,observed:n,passed,passRate:n?p:null,interval95:n?[Math.max(0,center-margin),Math.min(1,center+margin)]:null,complete:n>0};
  });
  const complete=missingMappings.length===0 && results.every(r=>r.complete) && results.length>0;
  const failures=results.flatMap(r=>r.runs).filter(r=>!r.passed).length;
  return {version:1,kind:'recorded-behavior-replay',complete,selectedScenarios:selected.length,missingMappings,failures,results,exitCode:complete?failures?1:0:2,note:'Assertions cover only supplied recorded mock traces. No live agent execution or runtime enforcement was performed.'};
}
