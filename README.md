# Receipt

**Verify what an AI coding agent _actually did_ — versus what it _claimed_ to do.**

Receipt reads your coding agent's session transcript (Claude Code, Cursor, OpenClaw), extracts
the claims it made, and **independently checks each one against reality** — git, the filesystem,
the test runner, the package lockfile, the build, HTTP endpoints, the database. Then it prints a
plain‑language **receipt**.

> Deterministic by design: **verification is code, never an LLM judging an LLM.** Works fully with
> **no API key, no network, no cost** (`--no-ai`, the default).

```text
RECEIPT · task: "add last_login tracking to auth" · 9s · claude-code
CLAIMED 4 actions — verified 3, FAILED 1, unverifiable 0

[✓] wrote a.js               verified (hash changed cc798ff5→5628ebf1)
[✓] edited b.js              verified (hash changed b85663f2→5cf0735d)
[✓] installed leftpad        verified (in package.json + node_modules)
[✗] ran tests: `npm test`    FAILED (1 failing: auth > rejects expired token)

VERDICT (fail): Do not trust as-is — tests: `npm test`: 1 failing: auth > rejects expired token.
```

---

## Contents

- [The problem](#the-problem)
- [The solution](#the-solution)
- [Quickstart](#quickstart)
- [How to use it properly](#how-to-use-it-properly)
- [What Receipt checks](#what-receipt-checks)
- [How it works](#how-it-works)
- [Where the output goes](#where-the-output-goes)
- [The three API modes](#the-three-api-modes)
- [CLI reference](#cli-reference)
- [Security & privacy](#security--privacy)
- [FAQ](#faq)
- [Status & roadmap](#status--roadmap)
- [Development](#development)
- [License](#license)

---

## The problem

AI coding agents are confident narrators. At the end of a task they write a tidy summary:

> *"Edited the auth middleware, added the migration, installed zod, and **all tests pass**."*

But that summary is **the agent asserting things about itself** — nothing independently checks it
against the final state of your repo. In practice the summary and reality drift apart constantly:

- **Stale "all tests pass."** The agent ran the tests early, then made three more edits that broke
  them. The summary still says green.
- **Hallucinated actions.** *"Installed `some-pkg`"* — but it's nowhere in `package.json` or
  `node_modules`.
- **Edits that didn't land.** *"Updated `X.tsx`"* — but the change was never written, or was
  reverted.
- **"Applied the migration"** — when the column still doesn't exist.

Your only options today are to **re-verify everything by hand** (slow, and you stop doing it after
a while) or **trust the summary blindly** (how bad changes get merged). Your IDE shows you tool
output _while_ the agent works, but nothing gives you a single, after‑the‑fact answer to: *did the
final result actually match what it told me?*

## The solution

Receipt closes that gap with **deterministic verification**:

1. **Read** the agent's session transcript (it's already written to disk — Receipt doesn't run the
   agent or touch its model).
2. **Extract** the concrete, checkable claims (files changed, packages installed, tests run, builds,
   commands, endpoints, migrations).
3. **Probe** each claim against the real world with plain code — re‑run the test suite, diff the
   files against git, read the lockfile, etc.
4. **Verdict:** `pass` / `warn` / `fail`, with a per‑claim breakdown and an exit code CI can gate on.

The key principle: **an LLM is never asked whether the work is good.** The checks are filesystem,
git, and process‑exit‑code facts. (An optional, off‑by‑default AI layer only writes a nicer summary
sentence and pulls extra claims out of prose — it never decides pass/fail.)

This was validated on real sessions. On one real Claude Code run of ~70 tool calls where the agent
committed and pushed its work, Receipt verified **50 actions, 0 false alarms**, and even told you
*which commit* each edit landed in (`verified (committed in 39221e8e)`).

## Quickstart

> Receipt is a TypeScript/Node monorepo (Node ≥ 20, pnpm). It is not on npm yet, so install from
> source.

```bash
git clone https://github.com/0xVintor/Receipt.git
cd Receipt
pnpm install
pnpm build

# run it
node packages/cli/bin/receipt.js --help
```

Put `receipt` on your PATH (optional but recommended):

```bash
# simplest — symlink the binary into a dir already on your PATH
ln -s "$PWD/packages/cli/bin/receipt.js" /opt/homebrew/bin/receipt
# or, if you've run `pnpm setup`:
cd packages/cli && pnpm link --global
```

Then, in **any project** right after your agent finishes a task:

```bash
cd /your/project
receipt check
```

That's it — no signup, no key. Receipt finds the latest agent session for that directory and prints
the verdict in seconds.

Want to see it catch a lie immediately? Run the self‑contained demo:

```bash
bash examples/demo.sh
```

## How to use it properly

**The core loop**

1. Let Claude Code / Cursor do a real task in a git project.
2. Before you accept/merge, run `receipt check` in that project.
3. Read the verdict and the red rows. Exit codes: `0` pass · `1` warn · `2` fail.

**It works whether the agent committed or not.** Receipt verifies an edit if it changed in the
**working tree** (uncommitted) *or* in a **commit made during the session** (committed/pushed). So
both "I left the changes for you" and "I committed and pushed" sessions verify correctly.

**Speed vs. thoroughness**

- `receipt check` re‑runs your test suite and build — most thorough, slower.
- `receipt check --no-tests` skips re‑running them — fast; still verifies files, packages, and the
  exit codes recorded in the trace. Good for a quick sanity pass.

**Reading the verdict**

- **`fail`** — at least one claim was contradicted by reality (a real test is red, a file wasn't
  changed, a package isn't installed). Don't merge without looking.
- **`warn`** — nothing is wrong, but some claims couldn't be checked (e.g. no dev server running for
  an endpoint claim, tests skipped). Glance at the `?` rows.
- **`pass`** — every checkable claim held up.

**Auto‑run after every turn (optional)** — install a Claude Code *Stop* hook:

```bash
cd /your/project
receipt init --command "receipt check --quiet --no-tests"   # per-project, fast one-liner
receipt init --uninstall                                     # to remove (idempotent + reversible)
```

`--no-tests` is recommended for the hook so it doesn't re‑run your whole suite after *every* turn.
The hook **does not consume your Claude Code credits** — the default path makes zero model calls.

**In CI (gate agent PRs)** — exit code `2` fails the job:

```yaml
- uses: ./.github/actions/receipt
  with:
    args: "--no-ai --since origin/${{ github.base_ref }}"
    comment: "true"   # posts the receipt as a PR comment
```

## What Receipt checks

| Claim | Verified when… | Notes |
| --- | --- | --- |
| **file_change** | the path changed in the working tree **or** a session commit, and content differs | shows the git hash change or commit sha |
| **package_install** | the package is in the manifest + lockfile + `node_modules` | **offline** — never calls the npm registry |
| **test_pass** | the detected test command **re‑runs** and exits 0 | captures failing test names; `--retries` flags flaky |
| **command_run** | the trace shows exit 0 for that command | read‑only — never re‑executes arbitrary commands |
| **build** | the detected build command runs and exits 0 | |
| **endpoint** | the URL responds with the expected status | loopback‑only by default (SSRF guard) |
| **migration** | the claimed table/column exists in the DB | SQLite via `--db-url`; read‑only |

Every probe **degrades to `unverifiable`** (never throws) when its dependency is missing — e.g.
`pytest` isn't installed, or there's no dev server. Read‑only/exploratory commands (`ls`, `grep`,
`git status`, …) are ignored, not treated as actions.

## How it works

```text
transcript ──▶ claims ──▶ probes ──▶ verdict
  (read)      (extract)  (verify)   (synthesize)
```

1. **Read** — parse the session transcript into a normalized run (tool calls, results, exit codes,
   the task, the final summary). Verified against the real Claude Code `~/.claude/projects/**/*.jsonl`
   format; parses defensively so schema drift never crashes it.
2. **Extract** — deterministic rules map tool calls to typed claims (`Write/Edit → file_change`,
   `npm install X → package_install`, test/build commands, etc.). With a key, an optional LLM step
   adds *prose‑only* claims the agent narrated but didn't tool‑call.
3. **Probe** — each claim is checked by read‑only code with per‑probe timeouts.
4. **Synthesize** — `fail` if anything failed, else `warn` if anything is unverifiable, else `pass`.

## Where the output goes

Not terminal‑only — Receipt writes to four places:

1. **Terminal** — the pretty receipt (default).
2. **Markdown** — a saved copy at `.receipt/receipts/<timestamp>.md` you can commit or paste into a
   PR (secrets redacted).
3. **`--json`** — machine‑readable, schema mirrors the `Verdict` type (for scripts/CI).
4. **History & dashboard** — every run is stored in `~/.receipt/receipt.db`; browse it with
   `receipt history` / `receipt show`, or visually with the local dashboard (`localhost:4317`).

## The three API modes

| Mode | Setup | Cost | What you get |
| --- | --- | --- | --- |
| **Keyless** (default) | nothing | $0, no network | Full deterministic verification |
| **BYO key** | `receipt config set-key <KEY>` | your provider's rate | + AI‑extracted prose claims and a friendlier one‑line summary |
| **Managed** | hosted dashboard | subscription | Server holds the key; team history + CI *(later phase)* |

```bash
receipt config set-provider google --model gemini-2.0-flash-lite
receipt config set-key "$GEMINI_API_KEY"
receipt config show          # key is masked
```

Even with a key, **all pass/fail verification stays deterministic** — the model only adds claims and
prose. Env vars (`RECEIPT_API_KEY`, `ANTHROPIC_API_KEY`, …) override stored config, so CI can stay
keyless.

## CLI reference

```text
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

receipt init                    install the Claude Code Stop hook (idempotent, reversible)
receipt config set-key [key]    store a provider API key (chmod 0600)
receipt config set-provider <p> google | anthropic | openai  [--model <id>]
receipt history [--limit N]     list recent receipts
receipt show [id]               re-render a stored receipt (default: latest)
```

**Exit codes:** `0` pass · `1` warn · `2` fail.

## Security & privacy

Designed to run on untrusted transcripts (e.g. an agent PR in CI) without risking your machine:

- **No network by default.** Keyless mode makes zero outbound requests. The only egress is the
  optional LLM call (only with a key) and the opt‑in `endpoint` probe.
- **Never executes commands from the transcript.** The test/build probes only run the command
  detected from *your* project config — never a string from the transcript. `command_run` is read
  purely from the recorded exit code.
- **Secrets redacted** before anything is written to the store or the markdown receipt
  (`API_KEY=…`, `Bearer …`, `sk-…`, AWS keys).
- **SSRF guard** on the `endpoint` probe (loopback only unless you pass `--start-cmd`).
- **Read‑only.** Probes never modify your source; the DB probe opens SQLite read‑only.
- **Keys at rest** in `~/.receipt/config.json` (chmod `0600`), masked in `config show`.

See **[SECURITY.md](SECURITY.md)** for the full posture, how to report a vulnerability, and the
dependency‑audit status (currently **0 high / 0 critical**; the few remaining low/moderate advisories
are unpatched‑upstream and confined to optional/build‑only paths).

## FAQ

**Do I need an AI API key?** No. ~95% of the value is the keyless deterministic path. A key only
buys cosmetic extras (a friendlier summary, prose‑claim extraction).

**Does it use my Claude Code / Cursor credits?** No. Receipt reads the transcript those tools
already wrote to disk; it never calls the agent's model.

**Isn't this what Claude Code / Cursor already do?** They show you tool output *live*. They do **not**
independently re‑check the agent's *final claims* against the *final* state — e.g. re‑running the
suite after the last edit to catch a stale "all tests pass." That's the gap Receipt fills.

**Does it modify my repo?** No source changes. It may re‑run your own tests/build (which produce the
same artifacts those tools always do); use `--no-tests` to skip that.

**My agent committed and pushed — will it still work?** Yes. Committed edits verify against the
commits made during the session, and the evidence shows the commit sha.

## Status & roadmap

**v0.1 — works today:** deterministic engine, Claude Code adapter, CLI, optional AI layer, local
SQLite history, the Claude Code hook, an MCP server (`verify_last_run`), a local dashboard, and a
GitHub Action. 67 tests.

**Best‑effort / next:** Cursor & OpenClaw adapters parse common export shapes but aren't yet tuned
to real exports — pass `--session <file> --agent cursor`. npm publish, a hosted team dashboard, and
more probe tuning are planned.

## Development

```bash
pnpm install
pnpm build       # turbo: core → cli → mcp → dashboard
pnpm test        # vitest (67 tests, incl. the acceptance + security suites)
pnpm typecheck
```

Layout:

```text
packages/core   verification engine (transcript → claims → probes → verdict)
packages/cli    the `receipt` binary
packages/mcp    MCP server exposing verify_last_run
apps/dashboard  local-first Next.js run viewer
examples/demo.sh  reproducible "catch the agent lying" demo
```

## License

MIT — see [LICENSE](LICENSE).
