export const PARSER_VERSION = 'skillcheck-md/1';
export const ENGINE_VERSION = '0.1.0';
export const RUBRIC_VERSION = 'skillcheck-relations/1';
export interface SourceSpan {
  path: string; startOffset: number; endOffset: number;
  startLine: number; startCharacter: number; endLine: number; endCharacter: number;
}
export interface Excerpt { text: string; span: SourceSpan }
export interface InstructionUnit extends Excerpt {
  snapshotId: string; unitId: string; authorId?: string; headingPath: string[];
  context: Excerpt[]; sourceRole: 'instruction' | 'example' | 'ambiguous';
  capabilityHints: string[]; contentFingerprint: string; contextFingerprint: string;
}
export interface Composition {
  id: string; files: string[];
  precedence: Array<{ higher: string; lower: string }>; assumptions: string[];
}
export interface Snapshot { id: string; files: Readonly<Record<string, string>>; config: Config; origin: string }
export interface Config {
  version: 1; include: string[]; exclude: string[]; compositions: Composition[];
  provider: { name: 'jev' | 'recorded'; model: string; apiKeyEnv: string; recordings?: string | undefined };
  semantic: { enabled: boolean; maxPairsPerRun: number; maxConcurrency: number; timeoutMs: number;
    maxRequestChars: number; maxRunMs: number; exhaustiveLimit: number; rubricVersion: string };
  ci: { mode: 'advisory' | 'enforce'; incomplete: 'error' };
  policy: { blockingKinds: string[] };
  suppressions: Array<{ fingerprint: string; contextFingerprint: string; reason: string; owner: string; expires: string }>;
  capabilities: Record<string, string[]>;
}
export interface Reference { from: string; target: string; span: SourceSpan; url: string }
export interface ParsedDocument { path: string; units: InstructionUnit[]; references: Reference[]; findings: Finding[] }
export interface Finding {
  fingerprint: string; contextFingerprint: string; kind: string; severity: 'error' | 'warning' | 'information';
  message: string; evidence: Excerpt[]; capabilityHints: string[]; complete: boolean;
  compositionId?: string; classification?: SemanticResult; suppressed?: boolean;
  status?: 'new' | 'existing' | 'resolved';
}
export interface SemanticRequest { task: 'change' | 'conflict'; units: InstructionUnit[]; composition: Composition; rubricVersion: string }
export interface SemanticResult {
  label: string; probabilities: Record<string, number>; providerConfidence?: number | undefined;
  provider: string; requestedModel: string; resolvedModel: string; rubricVersion: string;
  usage?: { inputTokens: number; outputTokens: number } | undefined;
}
export interface SemanticClassifier { classify(request: SemanticRequest, signal?: AbortSignal): Promise<SemanticResult> }
export interface Analysis {
  snapshot: Snapshot; documents: ParsedDocument[]; compositions: Composition[]; findings: Finding[];
  dependencies: Record<string, string[]>;
}
export interface Coverage {
  mode: 'deterministic' | 'semantic'; complete: boolean; candidatePairs: number;
  requested: number; completed: number; cacheHits: number; omitted: number; failed: number;
  affectedScopes: string[]; transmittedFiles: string[]; inputTokens: number; outputTokens: number;
}
export interface Report {
  version: 1; command: 'scan' | 'diff'; engineVersion: string; parserVersion: string;
  snapshots: Array<{ id: string; origin: string; configFingerprint: string }>;
  findings: Finding[]; coverage: Coverage; units: InstructionUnit[];
  changes?: Match[]; exitCode: 0 | 1 | 2;
}
export interface Match { kind: 'unchanged' | 'moved' | 'changed' | 'added' | 'removed' | 'ambiguous'; before: InstructionUnit[]; after: InstructionUnit[]; score?: number }
export interface AnalysisCache { get(key: string): Promise<SemanticResult | undefined>; set(key: string, result: SemanticResult): Promise<void> }
