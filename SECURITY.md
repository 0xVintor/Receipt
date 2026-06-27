# Security

## Reporting a vulnerability

Please report security issues privately via **GitHub Security Advisories**
(the *Security* tab → *Report a vulnerability*) rather than a public issue. We aim to respond
within a few days.

## Design posture (the code we wrote)

Receipt is built to run on **untrusted transcripts** (e.g. an agent PR in CI) without risking the
host:

- **No network by default.** With no API key configured (`--no-ai`, the default), Receipt makes
  **zero** outbound requests. The only egress points are the optional LLM call (only with a key)
  and the opt‑in `endpoint` probe.
- **Never executes commands from the transcript.** The test/build probes only run the command
  detected from *your* project config (`package.json`, etc.) — never a command string taken from the
  transcript. `command_run` is read purely from the recorded exit code; it never re‑executes
  anything. Read‑only/exploratory commands are ignored entirely.
- **Secrets are redacted** before anything is written to the local store or the persisted markdown
  receipt (`API_KEY=…`, `Bearer …`, `sk-…`, AWS keys, …).
- **SSRF guard** on the `endpoint` probe — loopback hosts only unless you pass `--start-cmd`.
- **Read‑only verification.** Probes never modify your source; the `migration` probe opens SQLite
  read‑only and quotes identifiers (no SQL injection from claim text).
- **Keys at rest** live in `~/.receipt/config.json` (chmod `0600`) and are masked in `config show`.

These are covered by tests in `packages/core/test/security.test.ts` (command‑injection, SSRF) and
the redaction tests.

> ⚠️ One inherent behavior to be aware of: running `receipt check` (without `--no-tests`) **re‑runs
> your project's own test/build scripts**. If you point it at an untrusted repository, those scripts
> execute — the same risk as any CI that runs `npm test` on a PR. Use `--no-tests` on untrusted code.

## Dependency advisories

`pnpm audit` currently reports **3 advisories (1 moderate, 2 low) — 0 high, 0 critical.** All three
are **unpatched upstream** (already on the latest published versions) and sit in non‑default or
build‑only paths:

| Advisory | Severity | Where | Real‑world exposure |
| --- | --- | --- | --- |
| `postcss` — XSS via unescaped `</style>` | moderate | dashboard **build tooling** (via Next.js) | only when processing *untrusted* CSS; the dashboard builds its own CSS, and it's not part of the shipped CLI |
| `ai` — filetype whitelist bypass | low | **optional** AI layer | only if you configure a key and use the AI features |
| `@ai-sdk/provider-utils` — uncontrolled resource consumption (DoS) | low | **optional** AI layer | only on the LLM response path, i.e. only with a key |

The default, keyless, deterministic path of the CLI **does not load the AI SDK at all** (it's lazy
‑imported only when a key is set), and the dashboard is a local‑first dev tool. We pin patched
versions of other transitive packages (`esbuild`, `vite`, `jsondiffpatch`, `postcss`) via pnpm
`overrides`, and will drop these three as soon as upstream fixes ship.

## Supported versions

This is pre‑1.0 (v0.x); security fixes land on `main`.
