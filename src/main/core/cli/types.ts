// src/main/core/cli/types.ts

type CapabilityDomain = 'browser' | 'shell' | 'filesystem' | 'system';

/** A single normalized command issued through CLIanything */
export interface CLICommand {
  /** Unique trace ID — caller generates, pass-through to CapabilityRequest */
  id: string;
  /** Human-readable name matching a registered CommandSpec key */
  name: string;
  /** Command-specific payload — validated by CommandSpec.schema before execution */
  params: Record<string, unknown>;
  /** Optional: override the default cwd for shell/fs commands */
  cwd?: string;
}

/** A batch of commands with an execution strategy */
export interface CLIBatch {
  id: string;
  /** 'sequential' runs each command in order, stopping on first error.
   *  'parallel' fires all simultaneously and collects all results. */
  strategy: 'sequential' | 'parallel';
  commands: CLICommand[];
}

/** Result from a single CLICommand execution */
export interface CLIResult {
  commandId: string;
  commandName: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  /** Forwarded from CapabilityResult for tracing */
  surface?: string;
  durationMs: number;
}

/** Result from a CLIBatch execution */
export interface CLIBatchResult {
  batchId: string;
  strategy: CLIBatch['strategy'];
  results: CLIResult[];
  ok: boolean;           // true only if ALL commands succeeded
  totalDurationMs: number;
}

/** Spec for a registered command — defines how to normalize it to a CapabilityRequest */
export interface CLICommandSpec {
  name: string;
  domain: CapabilityDomain;
  action: string;
  description: string;
  /** Map params keys to payload shape. Return the payload object. */
  buildPayload(params: Record<string, unknown>): Record<string, unknown>;
  /** Optional: validate params before building payload. Return error string or null. */
  validate?(params: Record<string, unknown>): string | null;
}
