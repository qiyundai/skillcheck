# Editor integration

Build with `pnpm build`. The standard LSP entry point is:

```sh
node /absolute/path/to/skillcheck/packages/cli/dist/skillcheck.mjs lsp --stdio
```

Use this process as a Markdown language server in any compatible client. Launch it with a single repository workspace folder. The current server uses the first folder in a multi-root workspace; open separate workspaces for independent repositories.

For VS Code, install `artifacts/skillcheck-0.1.0.vsix` with “Extensions: Install from VSIX”, then open a skill repository. Or open `packages/vscode` as an Extension Development Host after building. The client embeds the same server bundle as the CLI and requires no npm installation in the target repository.

Commands:

- **Skillcheck: Recheck Workspace** invalidates pending analysis and reruns it.
- **Skillcheck: Show Diff against Git Baseline** runs a deterministic disk diff in an output panel. Configure `skillcheck.baseline` (default `HEAD`). Save files first if the CLI comparison should include editor changes.

The server scans configured instruction files and watches Markdown/configuration changes. It accepts unsaved document overlays, preserves UTF-16 locations and publishes diagnostics with related evidence locations. Hover over a passage to inspect the retained original text and context fingerprint.

Local deterministic diagnostics run immediately. Cloud semantic checks require both repository `semantic.enabled` and user/application `skillcheck.allowCloudAnalysis: true` in VS Code. Other LSP clients must explicitly supply `initializationOptions.allowCloudAnalysis: true` or launch `lsp --stdio --semantic`. Repository configuration alone cannot enable cloud transmission from the editor. The extension is disabled in untrusted workspaces; they follow an 800 ms debounce. The server cancels obsolete requests and checks revisions before publishing even when providers ignore cancellation. Diagnostics clear on invalidation, and a `skillcheck/analysisStatus` notification reports pending, complete or incomplete analysis. The minimal VS Code client does not yet display that custom status notification in a status bar.

The stdio integration test opens an unsaved document with a broken link, verifies its versioned diagnostic, repairs it, and verifies clearing. Scheduler tests cover debounce and obsolete revisions. Compilation and protocol tests passed; this build has not been launched in a real VS Code Extension Host.
