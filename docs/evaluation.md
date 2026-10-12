# Semantic and behavioral evaluation

`skillcheck eval --dataset FILE` accepts JSONL rows:

```json
{"id":"approval-weakened","family":"authorization","split":"development","task":"change","texts":["You must ask before deletion.","You may ask before deletion."],"context":[],"acceptableLabels":["weakened"]}
```

The command uses the configured provider. Dataset IDs must be unique, labels must belong to the task taxonomy, and a family cannot appear in both development and held-out splits. Ambiguous rows can allow multiple labels. The output reports completed/failed counts, acceptable-label accuracy, abstention, confusion, a multiclass Brier score for single-label rows, latency and raw classifications. Provider/budget failures remain incomplete, and empty datasets are rejected. These metrics do not measure candidate retrieval or agent behavior.

The committed examples and recorded responses are plumbing fixtures. `fixtures/semantic/recorded.config.json` points to complete request fingerprints matching those fixtures. Run without cloud access:

```sh
node packages/cli/dist/skillcheck.mjs eval \
  --config fixtures/semantic/recorded.config.json \
  --dataset fixtures/semantic/examples.jsonl
```

Recordings use `requestFingerprint` from `recordingFingerprint(request)` in `packages/providers/src/index.ts`, and a validated `result` carrying the complete task label distribution, provider/model/rubric metadata. Changing context, headings, provenance paths, composition, precedence or rubric requires a new recording. There is no text-only fallback. Missing records produce incomplete analysis.

Before enforcement, replace or extend these seeds with independently annotated examples from the target repository. Include paraphrases, must/should changes, exceptions, negation, moves, splits/merges, multilingual passages and unresolved cases. Keep template families separate between development and held-out sets, and preserve annotation disagreement rather than forcing a single label. Never tune the rubric against the held-out set.

## Recorded behavior

```sh
node packages/cli/dist/skillcheck.mjs replay \
  --scenarios fixtures/semantic/scenarios.json \
  --traces fixtures/semantic/traces.json
```

Scenarios contain an ID, composition ID, linked instruction paths, task input, mock environment and tool assertions (`minCalls`, optional `maxCalls`, `requiresAuthorization`). Traces identify the scenario/run, harness version, execution model and calls with tool arguments and recorded authorization status. Each assertion checks observed trace calls; no tool is executed.

Use `--input diff-report.json` to replay only scenarios mapped to changed instruction paths. Missing mappings, missing traces, empty selected coverage and unknown trace/scenario IDs are explicit. Repeated runs show counts, observed pass rate and a Wilson 95% interval. These are sampling summaries of the supplied records, not proof of runtime safety. Authorization flags are trusted trace evidence; this command does not itself enforce authorization gates.
