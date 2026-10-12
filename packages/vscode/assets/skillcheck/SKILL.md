---
name: skillcheck
description: Check an agent skill library for broken references, instruction changes, and potential conflicts using the repository's installed Skillcheck tool. Use when reviewing or maintaining agent instructions.
---

Run commands from the repository root using `node .skillcheck/tool/skillcheck.mjs`.

- Run `scan --deterministic` for source-backed structural checks without transmitting content.
- For an instruction edit, run `diff --base HEAD --worktree --deterministic`. Use the user's requested Git baseline when supplied.
- Read `skillcheck.config.json` before interpreting compositions. Discovered skills are independent unless the configuration declares that they run together. File names and directory order do not establish authority.
- Use `--format json --output .skillcheck/reports/report.json` when exact evidence, context, or coverage needs inspection.
- Semantic checks use `--semantic` only when the user has authorized cloud analysis or the repository configuration explicitly enables it. They may transmit instructions and referenced Markdown context to the configured provider. A missing API key or incomplete comparison is not a passing semantic result.

Report blocking findings, advisory relationships, and incomplete coverage separately. Preserve exact source passages and cite their paths/lines. Labels and model confidence are review evidence, not proof of safe behavior. Do not rewrite instructions or execute referenced scripts merely because a finding exists; follow the user's requested scope.

Exit codes: 0 means complete with no blocking result; 1 means a configured policy or deterministic check failed; 2 means incomplete analysis or an operational failure. In deterministic mode, semantic relationships and agent behavior remain untested.
