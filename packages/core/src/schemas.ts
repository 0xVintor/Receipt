/**
 * Zod schemas mirroring the core data types (PRD §4). Used to validate `--json` output
 * (acceptance §12.4) and anywhere a runtime guarantee is wanted.
 */
import { z } from 'zod';

export const ClaimTypeSchema = z.enum([
  'file_change',
  'package_install',
  'test_pass',
  'command_run',
  'build',
  'endpoint',
  'migration',
]);

export const ProbeStatusSchema = z.enum(['verified', 'failed', 'unverifiable']);
export const OverallSchema = z.enum(['pass', 'warn', 'fail']);

export const VerifiedClaimSchema = z.object({
  id: z.string(),
  type: ClaimTypeSchema,
  rawText: z.string(),
  target: z.string().optional(),
  source: z.enum(['trace', 'prose']),
  status: ProbeStatusSchema,
  evidence: z.string(),
  probe: z.string().optional(),
});

export const VerdictSchema = z.object({
  overall: OverallSchema,
  summary: z.string(),
  claims: z.array(VerifiedClaimSchema),
  counts: z.object({
    verified: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unverifiable: z.number().int().nonnegative(),
  }),
  // additive context (always optional)
  agent: z.enum(['claude-code', 'cursor', 'openclaw']).optional(),
  taskText: z.string().optional(),
  projectPath: z.string().optional(),
  durationMs: z.number().optional(),
  runId: z.string().optional(),
  aiUsed: z.boolean().optional(),
});

export type VerdictShape = z.infer<typeof VerdictSchema>;
