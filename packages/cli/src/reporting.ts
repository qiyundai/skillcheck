import type { Finding, Report } from '@skillcheck/core';
function location(f:Finding):string {const span=f.evidence[0]?.span;return span?`${span.path}:${span.startLine+1}:${span.startCharacter+1}`:'workspace';}
export function terminal(report:Report):string {
  const visible=report.findings.filter(f=>!f.suppressed && f.status!=='resolved' && (f.severity!=='information' || f.kind.startsWith('instruction-') || f.kind==='configuration-changed'));
  return [`Skillcheck ${report.command}: ${report.coverage.complete?'complete':'INCOMPLETE'} (${report.coverage.mode})`,`${report.units.filter(u=>u.sourceRole!=='example').length} source-backed units; ${visible.length} review items; ${report.coverage.completed}/${report.coverage.candidatePairs} semantic comparisons.`,...visible.map(f=>`${f.severity.toUpperCase()} ${location(f)} [${f.status??'current'}] ${f.kind}: ${f.message}`),report.coverage.mode==='deterministic'?'Semantic analysis disabled; semantic relationships and behavior were not evaluated.':`Coverage: ${report.coverage.omitted} omitted, ${report.coverage.failed} failed, ${report.coverage.cacheHits} cached.`, `Exit ${report.exitCode}.`].join('\n')+'\n';
}
const escape=(s:string)=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!));
export function markdown(report:Report):string {
  const lines=[`# Skillcheck ${report.command}`,``, `Analysis **${report.coverage.complete?'complete':'incomplete'}**, mode **${report.coverage.mode}**. Exit code: ${report.exitCode}.`, ``, `Engine: ${report.engineVersion}. Parser: ${report.parserVersion}.`, ``, ...report.snapshots.map(s=>`- Snapshot \`${s.id}\` (${escape(s.origin)}), config \`${s.configFingerprint}\`.`),``, `Coverage: ${report.coverage.completed}/${report.coverage.candidatePairs} comparisons completed; ${report.coverage.omitted} omitted; ${report.coverage.failed} failed; ${report.coverage.cacheHits} cache hits.`, `Usage: ${report.coverage.inputTokens} input tokens, ${report.coverage.outputTokens} output tokens (uncached successful responses).`, ``, report.coverage.mode==='deterministic'?'Semantic analysis is disabled. No claim of semantic equivalence or unchanged agent behavior.':'Labels are review evidence; no findings do not establish safe agent behavior.', ``, `Transmitted source paths: ${report.coverage.transmittedFiles.map(escape).join(', ')||'none'}.`, ``, `Affected scopes with omissions: ${report.coverage.affectedScopes.map(escape).join(', ')||'none'}.`];
  for(const status of ['new','existing','resolved','current'] as const) {
    const findings=report.findings.filter(f=>(f.status??'current')===status);if(!findings.length)continue;lines.push('',`## ${status[0]!.toUpperCase()+status.slice(1)} findings`,'');
    for(const f of findings) {
      lines.push(`### ${escape(f.kind)} — ${escape(location(f))}${f.suppressed?' (suppressed)':''}`,'',escape(f.message),'',`Severity: ${f.severity}. Evidence/context fingerprint: \`${f.contextFingerprint}\`.`,`Capabilities: ${f.capabilityHints.join(', ')||'unknown'}.`,'');
      if(f.classification)lines.push(`Provider: ${f.classification.provider}; requested model: ${escape(f.classification.requestedModel)}; resolved model: ${escape(f.classification.resolvedModel)}; rubric: ${f.classification.rubricVersion}.`,`Selected-label probability: ${f.classification.probabilities[f.classification.label]}; provider confidence: ${f.classification.providerConfidence??'unavailable'}.`, '',`<pre>${escape(JSON.stringify(f.classification.probabilities,null,2))}</pre>`,'');
      for(const e of f.evidence) lines.push(`**${escape(e.span.path)}:${e.span.startLine+1}:${e.span.startCharacter+1}**`,'',`<pre>${escape(e.text)}</pre>`,'');
    }
  }
  return lines.join('\n')+'\n';
}
export function formatReport(report:Report,format:string):string {if(format==='json')return JSON.stringify(report,null,2)+'\n';if(format==='markdown')return markdown(report);if(format==='terminal')return terminal(report);throw new Error(`Unknown format: ${format}.`);}
