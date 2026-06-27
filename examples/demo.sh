#!/usr/bin/env bash
#
# Reproducible Receipt demo: seed a repo where an agent edited 2 files, installed a package,
# and CLAIMED the tests pass — but one test is red. Then run `receipt check --no-ai` and watch
# it catch the lie. No API key, no network.
#
# Usage:  bash examples/demo.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RECEIPT="node $ROOT/packages/cli/bin/receipt.js"

REPO="$(mktemp -d)"
SESS="$(mktemp -d)"
trap 'rm -rf "$REPO" "$SESS"' EXIT

# --- seed a tiny project (baseline) ---
cat > "$REPO/package.json" <<'JSON'
{ "name": "demo", "version": "1.0.0", "scripts": { "test": "node run-tests.cjs" }, "dependencies": { "leftpad": "^1.0.0" } }
JSON
cat > "$REPO/run-tests.cjs" <<'JS'
const assert = require('assert');
try { assert.strictEqual(1 + 1, 3); console.log('PASS'); }
catch { console.error('✗ auth > rejects expired token'); process.exit(1); }
JS
echo 'export const a = 1;' > "$REPO/a.js"
echo 'export const b = 1;' > "$REPO/b.js"
printf 'node_modules/\n.receipt/\n' > "$REPO/.gitignore"

git -C "$REPO" init -q
git -C "$REPO" config user.email demo@example.com
git -C "$REPO" config user.name Demo
git -C "$REPO" add -A && git -C "$REPO" commit -qm baseline

# package "installed" + agent "edits"
mkdir -p "$REPO/node_modules/leftpad"
echo '{"name":"leftpad","version":"1.0.0"}' > "$REPO/node_modules/leftpad/package.json"
echo 'export const a = 2; // edited' > "$REPO/a.js"
echo 'export const b = 2; // edited' > "$REPO/b.js"

# --- synthesize a Claude Code transcript where the agent claims tests pass ---
node - "$REPO" "$SESS/session.jsonl" <<'NODE'
const fs = require('fs');
const [repo, out] = process.argv.slice(2);
const base = { cwd: repo, sessionId: 'demo', version: '2.0.0' };
let t = Date.parse('2026-06-26T10:00:00Z');
const ts = () => new Date(t += 1000).toISOString();
const L = [];
L.push({ ...base, type: 'user', timestamp: ts(), message: { role: 'user', content: 'add last_login tracking to auth' } });
const tool = (name, input, result, code) => {
  const id = 'toolu_' + Math.random().toString(36).slice(2, 8);
  L.push({ ...base, type: 'assistant', timestamp: ts(), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
  L.push({ ...base, type: 'user', timestamp: ts(), toolUseResult: { stdout: result, stderr: '', code }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: code !== 0 }] } });
};
tool('Write', { file_path: repo + '/a.js' }, 'File written', 0);
tool('Edit', { file_path: repo + '/b.js' }, 'File edited', 0);
tool('Bash', { command: 'npm install leftpad' }, 'added 1 package', 0);
tool('Bash', { command: 'npm test' }, 'PASS', 0);
L.push({ ...base, type: 'assistant', timestamp: ts(), message: { role: 'assistant', content: [{ type: 'text', text: 'Edited a.js and b.js, installed leftpad, and all tests pass.' }] } });
fs.writeFileSync(out, L.map((x) => JSON.stringify(x)).join('\n') + '\n');
NODE

echo
echo "Running: receipt check --no-ai"
echo
set +e
$RECEIPT check --no-ai --session "$SESS/session.jsonl" --cwd "$REPO" --no-store
CODE=$?
set -e
echo
echo "exit code: $CODE   (0 pass · 1 warn · 2 fail)"
