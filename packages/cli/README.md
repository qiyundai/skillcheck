# Skillcheck CLI

Source-backed structural checks and opt-in semantic comparisons for agent skill libraries. Requires Node 22+. This archive bundles runtime dependencies; it does not need TypeScript or pnpm in the target repository.

Install this local archive with `npm install -g /path/to/skillcheck-cli-0.1.0.tgz`. The package has not been published to npm.

```sh
skillcheck init --root /path/to/repository --ci --skill-directory .agents/skills
cd /path/to/repository
node .skillcheck/tool/skillcheck.mjs scan --deterministic
node .skillcheck/tool/skillcheck.mjs diff --base HEAD --worktree
```

Initialization copies the executable, an optional helper skill and CI workflow into the repository. It preserves existing configuration and generated files unless `--force` is supplied; configuration is always preserved. Choose `--skill-directory skills`, `.claude/skills` or your library's own path, or omit installation with `--no-skill`.

Zero-config discovery finds `**/SKILL.md`, including hidden folders. Skills run in independent analysis scopes. Configure `skillcheck.config.json` with explicit `include`, `compositions`, `precedence` and `assumptions` to compare instructions that run together. AGENTS.md and other policy files are explicit opt-ins.

Semantic analysis is disabled by default. Enable it through configuration or `--semantic` with `TYPESAFE_API_KEY`; source and referenced Markdown context may be transmitted to TypeSafe. Requested semantic runs with missing credentials, failures, omitted comparisons or oversized context remain incomplete. Labels are advisory review evidence, not proof of behavior.

Reports support `--format terminal`, `json` or `markdown` and `--output FILE`. They retain original passages, exact UTF-16 spans, context, versions and coverage. The bundled language server runs with `skillcheck lsp --stdio`.

Exit codes: 0 complete/no blocking finding; 1 deterministic or configured enforcement failure; 2 incomplete/operational failure. Deterministic mode does not assess semantic relationships or agent behavior. Run `skillcheck --help` for the command list.
