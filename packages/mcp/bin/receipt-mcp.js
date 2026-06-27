#!/usr/bin/env node
import('../dist/index.js')
  .then((m) => m.main())
  .catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
