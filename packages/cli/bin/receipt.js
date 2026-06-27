#!/usr/bin/env node
// Entry point for the `receipt` binary. Keeps the shebang file tiny and ESM-only.
import('../dist/index.js')
  .then((m) => m.run(process.argv))
  .catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(2);
  });
