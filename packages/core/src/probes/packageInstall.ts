/**
 * package_install probe (PRD §6.4): verified if the package is in the manifest and lockfile
 * and resolvable; failed if absent; unverifiable when the toolchain is unknown.
 *
 * OFFLINE by design — never hits the npm registry (acceptance §12.2: no network without a
 * key). The registry "is this a hallucinated package name" check is a future online-only opt-in.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Claim, ProbeResult } from '../types.js';
import { ok, type Probe, type ProbeContext } from './types.js';

export const packageInstallProbe: Probe = {
  type: 'package_install',
  async run(claim: Claim, ctx: ProbeContext): Promise<ProbeResult> {
    try {
      const name = claim.target;
      if (!name) return ok('unverifiable', 'no package name in claim', 'packageInstall');
      const root = ctx.project.root;

      if (ctx.project.language === 'node') {
        const pkgPath = ctx.project.manifestPath ?? join(root, 'package.json');
        const inManifest = manifestHasDep(pkgPath, name);
        const resolvable = existsSync(join(root, 'node_modules', name, 'package.json'));
        const inLock = ctx.project.lockfilePath
          ? lockfileMentions(ctx.project.lockfilePath, name)
          : false;

        if (resolvable && inManifest) {
          return ok('verified', `in package.json + node_modules${inLock ? ' + lockfile' : ''}`, 'packageInstall');
        }
        if (resolvable) {
          return ok('verified', 'installed in node_modules (not saved to package.json)', 'packageInstall');
        }
        if (inManifest && inLock) {
          return ok('verified', 'in package.json + lockfile', 'packageInstall');
        }
        if (inManifest) {
          return ok('failed', 'declared in package.json but not installed (run install)', 'packageInstall');
        }
        return ok('failed', 'not found in package.json, lockfile, or node_modules', 'packageInstall');
      }

      // Generic: search the manifest text (requirements.txt, pyproject.toml, go.mod, Cargo.toml).
      if (ctx.project.manifestPath && existsSync(ctx.project.manifestPath)) {
        const text = safeRead(ctx.project.manifestPath).toLowerCase();
        if (text.includes(name.toLowerCase())) {
          return ok('verified', `present in ${baseName(ctx.project.manifestPath)}`, 'packageInstall');
        }
        return ok('failed', `not found in ${baseName(ctx.project.manifestPath)}`, 'packageInstall');
      }

      return ok('unverifiable', 'no recognized manifest to check', 'packageInstall');
    } catch (e) {
      return ok('unverifiable', `probe error: ${errMsg(e)}`, 'packageInstall');
    }
  },
};

function manifestHasDep(pkgPath: string, name: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
    const buckets = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    return buckets.some((b) => {
      const dep = pkg[b] as Record<string, unknown> | undefined;
      return dep != null && Object.prototype.hasOwnProperty.call(dep, name);
    });
  } catch {
    return false;
  }
}

function lockfileMentions(lockPath: string, name: string): boolean {
  try {
    const text = readFileSync(lockPath, 'utf8');
    // Quote-bounded match avoids matching substrings of other package names.
    return (
      text.includes(`"${name}"`) ||
      text.includes(`'${name}'`) ||
      text.includes(`\n${name}:`) ||
      text.includes(`/${name}@`) ||
      text.includes(` ${name}@`)
    );
  } catch {
    return false;
  }
}

function safeRead(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function baseName(p: string): string {
  return p.split('/').pop() || p;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
