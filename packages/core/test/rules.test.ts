/**
 * Deterministic claim rules (PRD §6.2), including regression coverage for the install-parser
 * bug where `pnpm install 2>&1 | tail -n 30` produced bogus package claims.
 */
import { describe, it, expect } from 'vitest';
import {
  extractInstalledPackages,
  canonicalPackageName,
  isTestCommand,
  isBuildCommand,
  claimsFromEvent,
  extractRuleClaims,
} from '../src/claims/rules.js';
import type { RunEvent } from '../src/types.js';

describe('extractInstalledPackages', () => {
  it('extracts explicit packages, stripping versions', () => {
    expect(extractInstalledPackages('npm install zod@3.23').map((p) => p.name)).toEqual(['zod']);
    expect(extractInstalledPackages('pnpm add -D vitest typescript').map((p) => p.name)).toEqual([
      'vitest',
      'typescript',
    ]);
    expect(extractInstalledPackages('yarn add @scope/pkg@^1.2.3').map((p) => p.name)).toEqual([
      '@scope/pkg',
    ]);
  });

  it('returns nothing for a bare install (all deps)', () => {
    expect(extractInstalledPackages('npm install')).toEqual([]);
    expect(extractInstalledPackages('pnpm install')).toEqual([]);
  });

  it('REGRESSION: does not treat redirections/pipes as package names', () => {
    expect(extractInstalledPackages('pnpm install 2>&1 | tail -n 30')).toEqual([]);
    expect(extractInstalledPackages('npm install > out.log 2>&1')).toEqual([]);
    expect(extractInstalledPackages('cd /tmp && npm install')).toEqual([]);
  });
});

describe('canonicalPackageName', () => {
  it('keeps scope, drops version', () => {
    expect(canonicalPackageName('react@18.2.0')).toBe('react');
    expect(canonicalPackageName('@scope/name@1.0')).toBe('@scope/name');
    expect(canonicalPackageName('lodash')).toBe('lodash');
  });
});

describe('command classification', () => {
  it('detects test commands', () => {
    for (const c of ['npm test', 'pnpm run test', 'npx vitest run', 'pytest -q', 'go test ./...', 'cargo test']) {
      expect(isTestCommand(c)).toBe(true);
    }
    expect(isTestCommand('npm run dev')).toBe(false);
  });

  it('detects build commands', () => {
    for (const c of ['npm run build', 'tsc -p .', 'next build', 'vite build', 'cargo build', 'go build ./...']) {
      expect(isBuildCommand(c)).toBe(true);
    }
    expect(isBuildCommand('echo hi')).toBe(false);
  });
});

describe('claimsFromEvent', () => {
  const ev = (toolName: string, toolInput: Record<string, unknown>): RunEvent => ({
    role: 'assistant',
    toolName,
    toolInput,
  });

  it('maps file writes to file_change', () => {
    const c = claimsFromEvent(ev('Write', { file_path: '/p/x.ts' }));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ type: 'file_change', target: '/p/x.ts', source: 'trace' });
  });

  it('maps install to package_install (and not command_run)', () => {
    const c = claimsFromEvent(ev('Bash', { command: 'npm install zod' }));
    expect(c.map((x) => x.type)).toEqual(['package_install']);
  });

  it('maps test command to test_pass only', () => {
    const c = claimsFromEvent(ev('Bash', { command: 'npm test' }));
    expect(c.map((x) => x.type)).toEqual(['test_pass']);
  });

  it('maps other bash to command_run', () => {
    const c = claimsFromEvent(ev('Bash', { command: 'ls -la' }));
    expect(c.map((x) => x.type)).toEqual(['command_run']);
  });
});

describe('extractRuleClaims dedupe', () => {
  it('de-duplicates by (type,target)', () => {
    const events: RunEvent[] = [
      { role: 'assistant', toolName: 'Write', toolInput: { file_path: '/p/x.ts' } },
      { role: 'assistant', toolName: 'Edit', toolInput: { file_path: '/p/x.ts' } },
      { role: 'assistant', toolName: 'Bash', toolInput: { command: 'ls' } },
      { role: 'assistant', toolName: 'Bash', toolInput: { command: 'ls' } },
    ];
    const claims = extractRuleClaims(events);
    expect(claims.filter((c) => c.type === 'file_change')).toHaveLength(1);
    expect(claims.filter((c) => c.type === 'command_run')).toHaveLength(1);
  });
});
