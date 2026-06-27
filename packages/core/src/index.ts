/**
 * @receipt/core public API.
 */
export * from './types.js';
export * from './schemas.js';

// Orchestration
export { verifyRun, NoSessionError } from './run.js';
export type { RunResult } from './run.js';

// Transcript
export { detectAndLoad, sniffAgent } from './transcript/index.js';
export {
  loadClaudeCodeSession,
  locateLatestSession,
  findSessionsForCwd,
  encodeProjectPath,
  projectsRoot,
} from './transcript/claudeCode.js';

// Claims
export { extractClaims, extractRuleClaims } from './claims/extract.js';
export {
  claimsFromEvent,
  extractInstalledPackages,
  isTestCommand,
  isBuildCommand,
  isReadOnlyCommand,
  canonicalPackageName,
  FILE_WRITE_TOOLS,
  TEST_PATTERNS,
  BUILD_PATTERNS,
} from './claims/rules.js';
export { extractProseClaims } from './claims/ai.js';

// Probes
export { verifyClaim, verifyClaims, getProbe, PROBES } from './probes/index.js';
export type { Probe, ProbeContext } from './probes/types.js';

// Project / git / regression
export { detectProject } from './project/detect.js';
export type { ProjectInfo, PackageManager, Language } from './project/detect.js';
export { buildGitContext, repoRelative } from './git/index.js';
export type { GitInfo } from './git/index.js';
export { captureSnapshots, touchedSourceFiles } from './regression/index.js';
export type { SnapshotRecord } from './regression/index.js';

// Verdict
export {
  synthesizeVerdict,
  computeCounts,
  computeOverall,
  templateSummary,
} from './verdict/synthesize.js';

// Store
export { ReceiptStore, openStore, defaultDbPath, redact } from './store/db.js';
export type { SavedRun } from './store/db.js';

// Config + LLM
export {
  readConfig,
  writeConfig,
  resolveLlm,
  configPath,
  receiptHome,
  defaultModel,
} from './config.js';
export type { ReceiptConfig, Provider, ResolvedLlm } from './config.js';
export { isAiAvailable, complete } from './llm/client.js';
