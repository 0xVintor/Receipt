/**
 * Safe command execution for probes. Never throws — returns a structured result with the
 * exit code, output, and a timedOut flag. Used by the test/build probes to re-run the
 * project's own tooling. READ-ONLY intent: probes only run verification commands.
 */
import { execa } from 'execa';
import { platform } from 'node:os';

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function runShell(
  cmd: string,
  opts: { cwd: string; timeoutMs: number },
): Promise<ShellResult> {
  const isWin = platform() === 'win32';
  const file = isWin ? process.env.ComSpec || 'cmd.exe' : 'sh';
  const args = isWin ? ['/d', '/s', '/c', cmd] : ['-c', cmd];
  try {
    const r = await execa(file, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      all: false,
      stripFinalNewline: true,
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    return { code: r.exitCode ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut: false };
  } catch (e) {
    const err = e as {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      timedOut?: boolean;
      shortMessage?: string;
    };
    return {
      code: typeof err.exitCode === 'number' ? err.exitCode : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.shortMessage ?? '',
      timedOut: err.timedOut === true,
    };
  }
}

/**
 * Heuristic: did the command fail because its tool is missing (vs. a real test/build failure)?
 * Used so probes degrade to `unverifiable` instead of `failed` when a dependency is absent (§12.7).
 */
export function isMissingTool(code: number, output: string): boolean {
  if (code === 127) return true;
  return /command not found|: not found|No module named|is not recognized as an internal|executable file not found|ENOENT|cannot find module|could not determine executable/i.test(
    output,
  );
}

/** Last non-empty line of combined output — handy for one-line evidence. */
export function lastLine(...chunks: string[]): string {
  const text = chunks.filter(Boolean).join('\n');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1]! : '';
}
