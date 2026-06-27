# Receipt

**Verify what an AI coding agent actually did — versus what it claimed to do.**

After an agent (Claude Code, Cursor, OpenClaw) finishes a task, Receipt reads the session
transcript, extracts the agent's claims, then **independently checks each claim against
reality** — git, the filesystem, the test runner, the package lockfile, the build, HTTP
endpoints, the database — and prints a plain-language receipt:

```
RECEIPT · task: "add last_login tracking to auth" · 9s · claude-code
CLAIMED 4 actions — verified 3, FAILED 1, unverifiable 0

[✓] wrote a.js               verified (hash changed cc798ff5→5628ebf1)
[✓] edited b.js              verified (hash changed b85663f2→5cf0735d)
[✓] installed leftpad        verified (in package.json + node_modules)
[✗] ran tests: `npm test`    FAILED (1 failing: auth > rejects expired token)

VERDICT (fail): Do not trust as-is — tests: `npm test`: 1 failing: auth > rejects expired token.
```

> **Core principle:** verification is **deterministic code, never an LLM judging an LLM.**
> An LLM is used *only* (and optionally) to (a) parse free-text claims not in the structured
> trace and (b) write the one-line summary. Receipt works fully with `--no-ai` — **no API key,
> no network, no cost.**

---

## Quickstart

```bash
# in a project where an agent just finished a task
npx receipt check
```

That's it — no signup, no key. Receipt finds the latest agent session for the current
directory, verifies the claims, and prints the receipt in seconds.

From this monorepo (before publishing):

```bash
pnpm install && pnpm build
node packages/cli/bin/receipt.js check
# or try the self-contained demo:
bash examples/demo.sh
```

## Auto-run on every agent turn (the hook)

Install a Claude Code **Stop** hook so a receipt prints automatically whenever an agent
finishes:

```bash
receipt init           # writes .claude/settings.json   (idempotent + reversible)
receipt init --global  # ~/.claude/settings.json
receipt init --uninstall
```

The hook runs `npx receipt check --quiet`. **It does not consume your Claude Code credits** —
the default path makes zero model calls.

## The three API modes

| Mode | How | Cost | What you get |
| ---- | --- | ---- | ------------ |
| **Keyless** (default) | nothing to set up | $0, no network | Full deterministic verification |
| **BYO key** | `receipt config set-key <KEY>` | your provider's price | + AI-extracted prose claims & a friendlier one-line summary |
| **Managed** | hosted dashboard (later phase) | subscription | Server holds the key; team history & CI |

```bash
receipt config set-provider google --model gemini-2.0-flash-lite
receipt config set-key "$GEMINI_API_KEY"
receipt config show
```

Environment variables always override stored config (`RECEIPT_API_KEY`, `RECEIPT_PROVIDER`,
`RECEIPT_MODEL`, or the provider-native `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
`GOOGLE_GENERATIVE_AI_API_KEY`). Even with a key, **all verification stays deterministic** —
the AI only adds claims and prose.

## CLI reference

```
receipt check [options]
  --no-ai            deterministic only (default when no key is set)
  --json             machine-readable JSON (schema mirrors Verdict)
  --session <path>   explicit transcript file
  --agent <kind>     claude-code | cursor | openclaw (auto-detect default)
  --since <gitref>   bound the task window / diff baseline
  --timeout <sec>    per-probe timeout (default 120)
  --snapshot         capture characterization snapshots for untested touched files
  --quiet            minimal one-line output (for hooks)
  --no-tests         skip re-running tests / build (faster)
  --retries <n>      mark a test flaky if results differ across n+1 runs
  --start-cmd <cmd>  dev-server start command (endpoint probe)
  --db-url <url>     database URL for the migration probe (sqlite supported)

receipt init                       install the Claude Code Stop hook
receipt config set-key [key]       store a provider API key (0600)
receipt config set-provider <p>    google | anthropic | openai  [--model <id>]
receipt history [--limit N]        list recent receipts
receipt show [id]                  re-render a stored receipt (default: latest)
```

> **Using the hook from this repo before publishing to npm:** the hook runs `npx receipt`,
> which resolves once the package is published. For local use, either `pnpm link --global`
> inside `packages/cli`, or install the hook with an explicit command:
> `receipt init --command "node /abs/path/packages/cli/bin/receipt.js check --quiet"`.

**Exit codes:** `0` pass · `1` warn · `2` fail — so CI can gate on the verdict.

## How it works

```
transcript ──► claims ──► probes ──► verdict
  (read)     (extract)  (verify)   (synthesize)
```

1. **Read** the agent's session transcript and normalize it to a `Run` (tool calls, results,
   exit codes, the task, the final summary).
2. **Extract claims** deterministically from the tool calls:
   `Write/Edit → file_change`, `npm/pnpm/yarn add X → package_install`, test commands →
   `test_pass`, build commands → `build`, anything else → `command_run`. (With a key, an LLM
   may add *prose-only* claims like "the endpoint returns 200".)
3. **Probe** each claim against reality — read-only, with timeouts, degrading to
   `unverifiable` when a dependency is missing:
   - `file_change` — changed in `git diff` since baseline **and** content hash differs
   - `package_install` — present in manifest + lockfile + `node_modules` (offline; no registry call)
   - `test_pass` — **re-runs** the suite; verified only on exit 0
   - `command_run` — exit 0 in the trace (never re-executes arbitrary commands)
   - `build` — runs the detected build command
   - `endpoint` / `migration` — HTTP status / DB schema introspection (opt-in)
4. **Synthesize** a verdict: `fail` if anything failed, else `warn` if anything is
   unverifiable, else `pass` — plus a one-line summary.

**Receipt never modifies your source.** Probes are read-only (it may re-run your project's own
tests/build, which only produce the artifacts those tools always produce). Secrets are
redacted before anything is stored.

## Supported agents

- **Claude Code** — full support, verified against the real `~/.claude/projects/**/*.jsonl`
  format.
- **Cursor / OpenClaw** — best-effort adapters; pass an exported session with
  `--session <file> --agent cursor`.

## Install the hook in CI

```yaml
# .github/workflows/verify.yml
- uses: ./.github/actions/receipt
  with:
    args: --no-ai --json
# exit code 2 fails the job when a claim is false
```

## Repository layout

```
packages/
  core/   the verification engine (transcript → claims → probes → verdict)
  cli/    the `receipt` binary
  mcp/    MCP server exposing `verify_last_run` (Phase 9)
apps/
  dashboard/   local-first Next.js run viewer (Phase 8)
examples/demo.sh   reproducible "catch the agent lying" demo
```

## Development

```bash
pnpm install
pnpm build         # turbo: core → cli
pnpm test          # vitest (42 tests incl. the §12 acceptance suite)
pnpm typecheck
```

## License

MIT.
