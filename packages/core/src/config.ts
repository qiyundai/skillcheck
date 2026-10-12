import { z } from 'zod';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Config, Finding, Excerpt, Snapshot } from './types.js';

const localPath = z.string().min(1).refine(p => !path.posix.isAbsolute(p) && !/^[A-Za-z]:|\\/.test(p) && !p.split('/').includes('..'), 'Paths must be workspace-relative POSIX paths');
const globPath=localPath.max(2048).refine(pattern=>{
  if(pattern.startsWith('!') && !pattern.startsWith('!('))return false;
  let depth=0;for(const ch of pattern){if('{(['.includes(ch)){if(++depth>16)return false;}else if('})]'.includes(ch))depth=Math.max(0,depth-1);}return true;
},'Glob patterns must have at most 16 nesting levels; use exclude for negated patterns');
export const configSchema = z.strictObject({
  version: z.literal(1).default(1),
  include: z.array(globPath).min(1).default(['**/SKILL.md']),
  exclude: z.array(globPath).default([]),
  compositions: z.array(z.strictObject({ id: z.string().min(1), files: z.array(localPath).min(1),
    precedence: z.array(z.strictObject({ higher: localPath, lower: localPath })).default([]),
    assumptions: z.array(z.string()).default([]) })).default([]),
  provider: z.strictObject({ name: z.enum(['jev', 'recorded']).default('jev'), model: z.string().min(1).default('jev-1.13.0'),
    apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('TYPESAFE_API_KEY'), recordings: localPath.optional() }).default({ name: 'jev', model: 'jev-1.13.0', apiKeyEnv: 'TYPESAFE_API_KEY' }),
  semantic: z.strictObject({ enabled: z.boolean().default(false), maxPairsPerRun: z.number().int().min(0).max(100000).default(300),
    maxConcurrency: z.number().int().min(1).max(32).default(4), timeoutMs: z.number().int().min(1).max(120000).default(10000),
    maxRequestChars: z.number().int().min(100).max(1000000).default(32000), maxRunMs: z.number().int().min(1).max(600000).default(60000),
    exhaustiveLimit: z.number().int().min(2).max(1000).default(40), rubricVersion: z.literal('skillcheck-relations/1').default('skillcheck-relations/1') }).default({enabled:false,maxPairsPerRun:300,maxConcurrency:4,timeoutMs:10000,maxRequestChars:32000,maxRunMs:60000,exhaustiveLimit:40,rubricVersion:'skillcheck-relations/1'}),
  ci: z.strictObject({ mode: z.enum(['advisory', 'enforce']).default('advisory'), incomplete: z.literal('error').default('error') }).default({ mode: 'advisory', incomplete: 'error' }),
  policy: z.strictObject({ blockingKinds: z.array(z.string()).default([]) }).default({ blockingKinds: [] }),
  suppressions: z.array(z.strictObject({ fingerprint: z.string().min(1), contextFingerprint: z.string().min(1), reason: z.string().min(1), owner: z.string().min(1), expires: z.iso.date() })).default([]),
  capabilities: z.record(z.string(), z.array(z.string().min(1))).default({ deletion: ['delete', 'remove', 'destroy'], external_messages: ['send', 'email', 'slack', 'message'], publication: ['publish', 'deploy', 'release'], financial: ['payment', 'purchase', 'transfer'], credentials: ['secret', 'credential', 'password', 'token'] }),
});
export function parseConfig(input: unknown = {}): Config { return configSchema.parse(input); }
export const DEFAULT_CONFIG = parseConfig();
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function createSnapshot(files: Record<string,string>, config: Config = DEFAULT_CONFIG, origin = 'memory'): Snapshot {
  for (const p of Object.keys(files)) if (path.posix.normalize(p) !== p || p.startsWith('/') || p.split('/').includes('..') || p.includes('\\')) throw new Error(`Invalid snapshot path: ${p}`);
  const copied = { ...files }; const cfg = structuredClone(config);
  return freeze({ id: hash({ files: copied, config: cfg }), files: copied, config: cfg, origin });
}
export function finding(kind: string, message: string, evidence: Excerpt[] = [], severity: Finding['severity'] = 'error', complete = true, scope?: string): Finding {
  const contextFingerprint = hash(evidence.map(e => ({path:e.span.path,text:e.text})));
  return { kind, message, evidence, severity, complete, fingerprint: hash({kind,contextFingerprint,scope,message}), contextFingerprint, capabilityHints: [], ...(scope ? {compositionId:scope} : {}) };
}
