# Implementation notes

## Implemented

- Strict TypeScript, pnpm workspace and a self-contained Node 22 CLI.
- Immutable snapshots; positioned Markdown AST; paragraphs, list ancestry, headings, YAML context, examples, ambiguous passages and UTF-16/CRLF evidence.
- Explicit compositions, missing file validation and precedence cycles; independent default scopes.
- Local Markdown dependency discovery, cycle/missing-link checks, reference definitions and boundary validation; referenced scripts are hashed but never executed.
- Change matching using unique optional author IDs, exact content/context, lexical/heading scores and ambiguous groups. `<!-- skillcheck:id approval -->` assigns an ID to the immediately following passage.
- Exhaustive small-scope pairing; lexical selection for larger scopes; explicit omitted coverage and budgets.
- Official TypeSafe Choice adapter, contextual recorded responses, runtime distributions, template explanations, deadlines, retries, usage and content-addressed cache.
- Git revision/worktree snapshots, merge-base comparisons, reports, fingerprint baselines and expiring context-bound suppressions.
- Standalone initialization, configurable helper skill location and deterministic GitHub Actions integration.
- LSP overlays, debounce, cancellation, revision checks, related information, context hover and a minimal VS Code extension.
- JSONL evaluation with acceptable-label accuracy, abstention, confusion, singleton Brier score and family split validation.
- Mock trace replay with deterministic tool assertions, scenario selection from changed instruction paths, explicit missing coverage and sampling intervals.

## Contract choices

The design's schemas were proposals. This implementation adds content/context fingerprints to units, `capabilities`, `exclude`, enforcement policy and suppressions to configuration, and explicit coverage counts to reports. The initial rubric is a fixed known version; arbitrary rubric IDs are rejected rather than silently mislabeled. `ci.incomplete` currently accepts only `error`; incomplete runs always exit 2.

A skill's YAML `name` and `description` must be present. This is an additional structural check for standard agent skill libraries. Non-skill policy Markdown does not require YAML.

Context includes original frontmatter, heading hierarchy, nested ancestors, other non-example units within the same heading section, and recursively referenced Markdown. Long contexts abstain instead of truncating. References to non-Markdown files contribute dependency fingerprints; their bytes are not interpreted as instructions or executed. Images and script contents are not semantically understood. Symlinked instruction/dependency files are not followed during disk discovery, and Git symlinks are rejected when requested. Dependencies outside the configured workspace are rejected.

The diff command intentionally reparses both snapshots. This is conservative and reproducible; fine-grained incremental parsing/reverse-dependency scheduling is not implemented yet. The LSP rechecks the whole configured workspace with a shared engine and uses its cache for semantic reuse. For diff, the request/time budget is shared between baseline, head and directional checks. Baseline-first scheduling can exhaust coverage before the head; reports state that limitation and do not establish resolution of uncompleted semantic comparisons.

A finding whose model/distribution changes gets a new evidence fingerprint. Unchanged cached evidence can be marked existing. Baselines acknowledge findings; they do not suppress or bypass blocking policy. Suppressions apply only to complete findings and must match exact context.

## Still to validate or extend

The Jev adapter is tested using mock responses, including malformed labels, credentials, retry and outage cases. A real authenticated smoke run is still needed. No secret was requested or inferred.

The example dataset is small and manually authored but not independently annotated. Recorded responses test mechanics, not semantic quality. Add repository-specific reviewed examples and separate held-out families before using semantic labels to block merges. Retrieval recall, model calibration, option-order sensitivity, negation robustness and end-to-end consequential-change accuracy need measurement.

No live agent harness is integrated. Trace assertions run only against supplied recorded mock traces and should not be described as unchanged real-agent behavior. Future harnesses should implement `BehaviorHarness` with enforced sandboxed tools and record their versions.

Other remaining work includes multi-rule analysis, full-composition checks, genuine incremental dependency scheduling, SARIF, editor status UX, performance benchmarks, hosted release/publishing and name availability checks. Embeddings remain deliberately absent pending measured retrieval recall.

The generated workflow follows the current official [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), and [upload-artifact](https://github.com/actions/upload-artifact) usage. It disables automatic package-manager caching so unrelated repository manifests and lockfiles are not prerequisites. Hidden report-directory upload is explicitly enabled for the specified report path.
