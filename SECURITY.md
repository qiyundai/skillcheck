# Security

Skillcheck 0.1 is experimental developer tooling. It provides review evidence, not a runtime sandbox, authorization gate, or certificate of safe agent behavior.

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/qiyundai/skillcheck/security/advisories/new). Do not include API keys or proprietary instruction excerpts in public issues.

## Data and execution boundaries

Deterministic analysis makes no model API calls. Semantic CLI analysis is explicitly enabled by `--semantic` or repository `semantic.enabled`; it can transmit original instructions and referenced Markdown context to the hardcoded HTTPS TypeSafe endpoint. When inspecting an unfamiliar repository, use `--deterministic` and inspect configuration before enabling semantics. There is no configurable third-party gateway.

The editor additionally requires a client/user-level cloud opt-in. In VS Code, `skillcheck.allowCloudAnalysis` is application-scoped and defaults to false; repository settings cannot enable it. The extension is disabled in untrusted workspaces. Generic LSP clients must explicitly enable cloud analysis in initialization options or launch arguments.

API keys are read from the configured environment-variable name. Keys are not placed in reports or cache entries. Reports contain original excerpts and retained context; they can expose credentials if credentials were already written into instructions. Cache entries contain classifications and provenance hashes, not original passage text. Treat reports and cache files as private local data. The project ignores environment files, private key files, generated reports, caches, source bundles and build artifacts in Git.

References stay within the workspace; remote links are not fetched. Referenced scripts are hashed and never executed. Skillcheck invokes Git using argument arrays, and its editor diff command does not interpolate refs into a shell. Installation rejects symlinked destinations, and snapshot reads check workspace boundaries. These are ordinary local file checks, not a defense against an adversary concurrently replacing filesystem entries.

CI runs with read-only repository permissions and no provider secret. Semantic analysis remains advisory by default. Workflow dependencies are pinned to commit SHAs. Public CI report artifacts may expose the excerpts they contain; generated workflows upload only the explicit report directory.

## Known limitations

A malicious configuration or large instruction library can consume CPU, memory, request quota, or cloud budget. Glob length/nesting, file sizes and semantic requests are bounded, but there is no complete process-level resource sandbox. Classifications can be wrong or manipulated by adversarial prose; prompt instructions are not a security enforcement mechanism. Pairwise and lexical retrieval omit some relationships and report that coverage.

A local review on 2026-10-12 found a high-severity stack-exhaustion advisory in the former `braces` dependency ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). The affected fast-glob/micromatch chain was removed in favor of picomatch and an explicit filesystem walker. Dependency audits and secret scans are snapshots of known checks, not proof that all vulnerabilities are absent.
