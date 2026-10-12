# Skillcheck

Source-backed checks, semantic diffs, and editor diagnostics for repositories with agent skill libraries. A TypeScript/pnpm implementation of the [design](docs/design.md), packaged as a standalone Node executable.

## Try it

Requires Node 22+; pnpm is needed only to develop/build this project.

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/skillcheck.mjs scan
```

Install into another repository without changing that repository's package dependencies:

```sh
node /absolute/path/to/skillcheck/packages/cli/dist/skillcheck.mjs init \
  --root /absolute/path/to/your-repo --ci --skill-directory .agents/skills

cd /absolute/path/to/your-repo
node .skillcheck/tool/skillcheck.mjs scan
node .skillcheck/tool/skillcheck.mjs diff --base HEAD --worktree
```

`init` installs the bundled executable, `skillcheck.config.json`, an agent helper skill, and optionally a GitHub Actions workflow. Existing files are preserved. `--force` refreshes generated tool, skill and workflow files; it still preserves configuration. Use `--no-skill` to omit the helper, or `--skill-directory .claude/skills`, `.codex/skills`, `skills`, or your own directory. Commit the generated files. The executable embeds its helper skill, so the installed copy can initialize another repository too.

The public source repository is https://github.com/qiyundai/skillcheck. There is no published npm package or Marketplace extension yet. Build a local npm archive with `pnpm pack:cli`; install that archive with `npm install -g /path/to/skillcheck-cli-0.1.0.tgz`, then use `skillcheck init --root /path/to/repo --ci`. A local VSIX is in `artifacts/`; see [editor setup](docs/editor.md).

## Discovery and composition

Zero-config scans discover `**/SKILL.md`, including hidden skill directories. `.git`, `node_modules`, `dist` and `.skillcheck` are excluded. SKILL.md files need nonempty `name` and `description` YAML metadata. Markdown references remain within the workspace; remote links are never fetched and referenced scripts are never executed.

Every discovered skill gets its own independent analysis scope. Skillcheck does not assume the entire library runs together. Policy files such as `AGENTS.md` are opt-in:

```json
{
  "version": 1,
  "include": ["**/SKILL.md", "AGENTS.md"],
  "exclude": ["archived/**"],
  "compositions": [
    {
      "id": "build-with-policy",
      "files": ["AGENTS.md", "skills/build/SKILL.md"],
      "precedence": [{ "higher": "AGENTS.md", "lower": "skills/build/SKILL.md" }],
      "assumptions": ["These instructions apply to the same build task."]
    }
  ],
  "semantic": { "enabled": false }
}
```

Precedence comes only from configuration. An AGENTS.md file has no automatically assigned authority. Composition paths are exact workspace-relative paths. Missing files, precedence cycles, broken local links, dependency cycles, invalid metadata and invalid configuration are deterministic errors.

## Commands

```sh
skillcheck scan --deterministic
skillcheck scan --semantic --format json --output report.json
skillcheck diff --base origin/main --head HEAD --merge-base --format markdown
skillcheck diff --base HEAD --worktree
skillcheck scan --baseline previous-report.json
skillcheck report --input report.json --format markdown
skillcheck eval --dataset fixtures/semantic/examples.jsonl
skillcheck replay --scenarios fixtures/semantic/scenarios.json --traces fixtures/semantic/traces.json
skillcheck lsp --stdio
```

`--root` sets the workspace boundary; output paths are relative to the invoking process's working directory. `--config` selects a workspace-relative configuration file. Disk worktree comparisons include untracked instruction files. Unsaved editor changes are available to the language server, not the disk CLI. Git snapshots parse both revisions' configuration and dependencies independently; `--merge-base` compares from the branch's actual divergence point. Shallow-history failures are explicit.

Reports include exact UTF-16 spans, original evidence, full retained context, snapshot/configuration fingerprints, model/rubric/parser versions, usage, transmitted paths and coverage. Diffs separate new, existing and resolved findings, additions/removals and ambiguous alignment. A baseline marks identical evidence as existing; it does not remove findings or bypass policy.

| Exit | Meaning |
| --- | --- |
| 0 | Requested analysis complete, no blocking policy result |
| 1 | Deterministic errors or explicitly enforced finding kinds |
| 2 | Incomplete coverage, missing credentials, provider failure or operational failure |

Deterministic mode does not assess semantic relationships or agent behavior. Semantic findings are advisory by default. `ci.mode: "enforce"` and `policy.blockingKinds` can opt into named findings after repository-specific evaluation. Incomplete analysis always exits 2; the initial implementation accepts only `ci.incomplete: "error"`.

## Optional semantic provider

Cloud analysis requires explicit opt-in through configuration or `--semantic`. Instructions and referenced Markdown context may leave the machine. The Jev adapter follows the [official TypeSafe API](https://docs.typesafe.ai/api) and [Choice contract](https://docs.typesafe.ai/primitives/choice), using the versioned model from the [model documentation](https://docs.typesafe.ai/models).

```json
{
  "version": 1,
  "provider": { "name": "jev", "model": "jev-1.13.0", "apiKeyEnv": "TYPESAFE_API_KEY" },
  "semantic": {
    "enabled": true,
    "maxPairsPerRun": 300,
    "maxConcurrency": 4,
    "timeoutMs": 10000,
    "maxRunMs": 60000,
    "maxRequestChars": 32000
  }
}
```

Set `TYPESAFE_API_KEY` in your environment, then run `skillcheck scan --semantic`. Credentials are never written to configuration. Requests retain original source and context as untrusted data. Distributions and task labels are validated. Requested and resolved models are separate; pinned models must resolve exactly. Aliases bypass persistent caching. Retries honor Retry-After and are bounded; request timeouts and a run budget cover both Git snapshots and directional comparisons. Cache records contain source-derived data and model results; treat `.skillcheck/cache` as local sensitive data.

No live API request was made while building this release: adapter verification uses mocked official-shaped responses. The repo also supports a recorded adapter keyed by complete task/text/context/composition/rubric fingerprints. See [evaluation](docs/evaluation.md).

Suppressions require a finding fingerprint, context fingerprint, reason, owner and ISO expiry date. Changed source/context invalidates them. They cannot suppress incomplete coverage into success.

## CI and editor

`init --ci` writes a minimal-permission workflow with full Git history, merge-base comparison, a job summary, and uploaded JSON/Markdown artifacts. It always uses deterministic mode and needs no secrets or registry dependencies. Semantic CI is an explicit later configuration change: remove `--deterministic`, configure the provider and supply its key according to your repository's trusted CI policy. Reports retain exit 2 for missing keys and incomplete coverage.

The language server shares the engine and supports unsaved Markdown/configuration overlays, immediate deterministic checks, an 800 ms semantic debounce with a separate user-level cloud opt-in, cancellation, versioned diagnostics, related locations, source/context hover and workspace rechecking. Obsolete responses cannot publish. The minimal VS Code client adds a deterministic Git diff command that passes arguments directly without a shell. See [editor setup](docs/editor.md).

Recorded behavioral replay checks tool-call assertions from mocked traces. It shows counts and Wilson intervals, and marks missing mappings/traces incomplete. It does not run a live agent. The `BehaviorHarness` interface is the integration point for a future sandboxed runtime.

## Development and limits

```sh
pnpm check
pnpm pack:cli
```

The package layout follows the design: `core`, `providers`, `cli`, `lsp`, `vscode`, and an `action` wrapper. Core takes immutable snapshots and has no Git, editor or reporting dependency. CLI distributions bundle runtime dependencies and include licenses in their archive.

This is a working 0.1 implementation, not a validated semantic safety checker. Pairwise analysis misses some multi-rule contradictions. Large compositions use lexical candidate selection and report all omitted pairs. Context stays within its heading section plus ancestry and referenced Markdown; applicability may also depend on prose elsewhere. There is no scope proof, runtime enforcement, automatic rewriting, embedding retrieval or autonomous PR action. Native editor installation, a live Jev smoke test, real-agent harness execution, a hand-reviewed 150-pair/30-composition dataset, held-out accuracy, retrieval recall and latency targets remain unvalidated. See [implementation notes](docs/implementation.md).
