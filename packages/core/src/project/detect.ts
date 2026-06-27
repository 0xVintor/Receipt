/**
 * Project detection (PRD §6.7): package manager, test runner, build command, framework.
 * Probes consume ProjectInfo instead of hard-coding tools, so Receipt works on any language
 * by shelling out to the project's own toolchain.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export type Language = 'node' | 'python' | 'go' | 'rust' | 'ruby' | 'php' | 'java' | 'unknown';

export interface ProjectInfo {
  root: string;
  language: Language;
  packageManager?: PackageManager;
  testCommand?: string;
  buildCommand?: string;
  framework?: string;
  manifestPath?: string;
  lockfilePath?: string;
}

const NPM_DEFAULT_TEST = 'echo "Error: no test specified" && exit 1';

export function detectProject(root: string): ProjectInfo {
  const has = (f: string) => existsSync(join(root, f));
  const readJson = (f: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(readFileSync(join(root, f), 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  // ---- Node / JS-TS ----
  if (has('package.json')) {
    const pkg = readJson('package.json') ?? {};
    const scripts = (pkg.scripts as Record<string, string>) ?? {};
    const deps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
    };

    let pm: PackageManager = 'npm';
    let lockfilePath: string | undefined;
    if (has('pnpm-lock.yaml')) {
      pm = 'pnpm';
      lockfilePath = join(root, 'pnpm-lock.yaml');
    } else if (has('yarn.lock')) {
      pm = 'yarn';
      lockfilePath = join(root, 'yarn.lock');
    } else if (has('bun.lockb') || has('bun.lock')) {
      pm = 'bun';
      lockfilePath = join(root, has('bun.lockb') ? 'bun.lockb' : 'bun.lock');
    } else if (has('package-lock.json')) {
      pm = 'npm';
      lockfilePath = join(root, 'package-lock.json');
    }

    const runner = pm === 'npm' ? 'npm run' : pm === 'yarn' ? 'yarn' : `${pm} run`;

    let testCommand: string | undefined;
    if (scripts.test && scripts.test.trim() !== NPM_DEFAULT_TEST) {
      testCommand = pm === 'yarn' ? 'yarn test' : `${pm} test`;
    } else if (deps.vitest) {
      testCommand = 'npx vitest run';
    } else if (deps.jest) {
      testCommand = 'npx jest';
    } else if (deps.mocha) {
      testCommand = 'npx mocha';
    } else if (deps['@playwright/test']) {
      testCommand = 'npx playwright test';
    }

    let buildCommand: string | undefined;
    if (scripts.build) {
      buildCommand = `${runner} build`;
    } else if (has('tsconfig.json')) {
      buildCommand = 'npx tsc --noEmit';
    }

    const framework =
      deps.next ? 'next' : deps.vite ? 'vite' : deps.react ? 'react' : deps.express ? 'express' : undefined;

    return {
      root,
      language: 'node',
      packageManager: pm,
      testCommand,
      buildCommand,
      framework,
      manifestPath: join(root, 'package.json'),
      lockfilePath,
    };
  }

  // ---- Python ----
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('setup.cfg')) {
    const manifestPath = has('pyproject.toml')
      ? join(root, 'pyproject.toml')
      : has('requirements.txt')
        ? join(root, 'requirements.txt')
        : has('setup.py')
          ? join(root, 'setup.py')
          : join(root, 'setup.cfg');
    return {
      root,
      language: 'python',
      testCommand: 'python3 -m pytest -q',
      buildCommand: has('pyproject.toml') ? 'python3 -m build' : undefined,
      manifestPath,
    };
  }

  // ---- Go ----
  if (has('go.mod')) {
    return {
      root,
      language: 'go',
      testCommand: 'go test ./...',
      buildCommand: 'go build ./...',
      manifestPath: join(root, 'go.mod'),
    };
  }

  // ---- Rust ----
  if (has('Cargo.toml')) {
    return {
      root,
      language: 'rust',
      testCommand: 'cargo test',
      buildCommand: 'cargo build',
      manifestPath: join(root, 'Cargo.toml'),
      lockfilePath: has('Cargo.lock') ? join(root, 'Cargo.lock') : undefined,
    };
  }

  // ---- Ruby ----
  if (has('Gemfile')) {
    return { root, language: 'ruby', testCommand: 'bundle exec rake test', manifestPath: join(root, 'Gemfile') };
  }

  return { root, language: 'unknown' };
}
