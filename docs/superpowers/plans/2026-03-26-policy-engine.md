# Policy Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move policy enforcement into `dispatch.ts`, add real-time approval flow, and build a policy UI for profile switching, audit log viewing, and inline approval cards.

**Architecture:** Three sequential sub-projects: (1) policy gate in `dispatch.ts` + dead code removal, (2) approval manager + IPC wiring for pause-and-wait approval, (3) renderer UI for profile switching, audit log, and inline approval cards.

**Tech Stack:** TypeScript, Electron IPC, React, existing `evaluatePolicy` from `src/main/agent/policy-engine.ts`, `better-sqlite3` for audit log.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/main/agent/dispatch.ts` | Add policy gate before tool execution |
| Modify | `src/main/anthropicChat.ts` | Remove dead policy block from executeTools() |
| Modify | `src/main/geminiChat.ts` | Remove dead policy block from tool loop |
| Create | `src/main/agent/approvalManager.ts` | Pending approval promise registry with timeout |
| Modify | `src/main/agent/types.ts` | Add `ApprovalInfo`, `requestApproval` to DispatchContext, `onApprovalRequested` to LoopOptions |
| Modify | `src/main/agent/agentLoop.ts` | Wire `requestApproval` callback into DispatchContext |
| Modify | `src/main/ipc-channels.ts` | Add POLICY_APPROVAL_REQUESTED, POLICY_APPROVAL_RESPOND, POLICY_AUDIT_LOG |
| Modify | `src/main/registerIpc.ts` | Add approval respond handler, audit log handler, wire onApprovalRequested |
| Create | `src/renderer/components/ApprovalCard.tsx` | Inline approve/deny card for chat stream |
| Create | `src/renderer/components/PolicyPanel.tsx` | Profile switcher + audit log viewer |
| Modify | `src/renderer/components/ChatPanel.tsx` | Listen for approval requests, render ApprovalCard |
| Create | `tests/renderer/agent/approvalManager.test.ts` | Unit tests for approval manager |

---

## Sub-project 1: Policy Gate in dispatch.ts

### Task 1: Add policy gate to dispatch.ts

**Files:**
- Modify: `src/main/agent/dispatch.ts`

- [ ] **Step 1: Add evaluatePolicy import**

At the top of `src/main/agent/dispatch.ts`, add:

```typescript
import { evaluatePolicy } from './policy-engine';
```

- [ ] **Step 2: Add policy gate to executeOne()**

In `src/main/agent/dispatch.ts`, replace the `executeOne` function (lines 44–86) with:

```typescript
async function executeOne(
  block: ToolUseBlock,
  ctx: DispatchContext,
): Promise<string> {
  if (ctx.signal.aborted) {
    return JSON.stringify({ ok: false, error: 'Cancelled' });
  }

  const { options } = ctx;

  // ── Policy gate ────────────────────────────────────────────────────────
  const decision = evaluatePolicy(block.name, block.input, { runId: ctx.runId });

  if (decision.effect === 'deny') {
    const msg = `[POLICY DENIED] ${decision.reason} (rule: ${decision.ruleId ?? 'none'}, profile: ${decision.profileName})`;
    options.onToolActivity?.({ id: block.id, name: block.name, status: 'error', detail: msg });
    return msg;
  }

  if (decision.effect === 'require_approval') {
    const msg = `[POLICY HELD] ${decision.reason} — tool "${block.name}" was not executed. Change the policy profile in Settings to allow it.`;
    options.onToolActivity?.({ id: block.id, name: block.name, status: 'error', detail: msg });
    return msg;
  }
  // ── End policy gate ────────────────────────────────────────────────────

  const startMs = Date.now();
  const argsSummary = JSON.stringify(block.input).slice(0, 120);
  const eventId = trackToolCall(ctx.runId, block.name, argsSummary);

  options.onToolActivity?.({
    id: block.id,
    name: block.name,
    status: 'running',
    detail: argsSummary,
  });

  let result: string;
  let isError = false;

  try {
    result = await routeToolExecution(block, ctx);
  } catch (err) {
    result = JSON.stringify({ ok: false, error: (err as Error).message });
    isError = true;
  }

  const durationMs = Date.now() - startMs;
  trackToolResult(ctx.runId, eventId, result.slice(0, 200), durationMs);

  options.onToolActivity?.({
    id: block.id,
    name: block.name,
    status: isError ? 'error' : 'success',
    detail: result.slice(0, 200),
    durationMs,
  });

  return result;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | grep -i "dispatch.ts" || echo "No errors in dispatch.ts"
```

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/dispatch.ts
git commit -m "feat(policy): add policy gate to dispatch.ts — evaluatePolicy before tool execution"
```

---

### Task 2: Remove dead policy code from anthropicChat.ts

**Files:**
- Modify: `src/main/anthropicChat.ts`

- [ ] **Step 1: Read the file to find the exact policy block**

Read `src/main/anthropicChat.ts` lines 290–350. The policy gate is inside `executeTools()`, starting at the comment `// ── Policy gate ──`. It includes the `evaluatePolicy` call, the `deny` branch, and the `require_approval` branch.

- [ ] **Step 2: Remove the policy gate from executeTools()**

In `src/main/anthropicChat.ts`, inside the `executeTools` function, find and remove the policy gate block. It starts at `// ── Policy gate ──` and ends at the line after the `require_approval` continue statement. The code after the gate (the actual tool execution via `executeShellTool` / `executeBrowserTool`) remains.

The block to remove looks like:

```typescript
      // ── Policy gate ──────────────────────────────────────────────────────
      const decision = evaluatePolicy(
        block.name,
        block.input as Record<string, unknown>,
        { runId: runId ?? undefined },
      );

      if (decision.effect === 'deny') {
        resultContent = `[POLICY DENIED] ${decision.reason} (rule: ${decision.ruleId ?? 'none'}, profile: ${decision.profileName})`;
        isError = true;
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
            id: block.id,
            name: block.name,
            status: 'error',
            detail: resultContent,
            policyDenied: true,
          });
        }
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultContent,
          is_error: true,
        });
        continue;
      }

      if (decision.effect === 'require_approval') {
        resultContent = `[POLICY HELD] This action requires your approval: ${decision.reason}. ` +
          `Tool "${block.name}" was not executed. You can approve it manually or change the policy profile in Settings.`;
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
            id: block.id,
            name: block.name,
            status: 'error',
            detail: `Requires approval: ${decision.reason}`,
            policyHeld: true,
          });
        }
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultContent,
        });
        continue;
      }
```

- [ ] **Step 3: Remove the evaluatePolicy import if unused**

Check if `evaluatePolicy` is imported at the top of the file. If so and it's no longer used anywhere in the file, remove the import line.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | grep -i "anthropicChat" || echo "No errors in anthropicChat.ts"
```

- [ ] **Step 5: Commit**

```bash
git add src/main/anthropicChat.ts
git commit -m "refactor(policy): remove dead policy gate from anthropicChat.ts executeTools()"
```

---

### Task 3: Remove dead policy code from geminiChat.ts

**Files:**
- Modify: `src/main/geminiChat.ts`

- [ ] **Step 1: Read the file to find the exact policy block**

Read `src/main/geminiChat.ts` lines 228–272. The policy gate starts at `// ── Policy gate ───` and ends at `// ── End policy gate ───`.

- [ ] **Step 2: Remove the policy gate block**

Remove the entire block from `// ── Policy gate ───` through `// ── End policy gate ───` (approximately lines 232–272). The code after it (`if (fc.name.startsWith('browser_') && browserService)` etc.) remains.

The block to remove:

```typescript
                // ── Policy gate ───────────────────────────────────────────────
                const policyDecision = evaluatePolicy(
                    fc.name,
                    fc.args as Record<string, unknown>,
                );

                if (policyDecision.effect === 'deny') {
                    resultStr = `[POLICY DENIED] ${policyDecision.reason} (rule: ${policyDecision.ruleId ?? 'none'}, profile: ${policyDecision.profileName})`;
                    if (!webContents.isDestroyed()) {
                        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
                            id: tcId,
                            name: uiName,
                            status: 'error',
                            detail: `Policy denied: ${policyDecision.reason}`,
                            policyDenied: true,
                        });
                    }
                    toolResultParts.push({
                        functionResponse: { name: fc.name, response: { result: resultStr, error: true } },
                    });
                    continue;
                }

                if (policyDecision.effect === 'require_approval') {
                    resultStr = `[POLICY HELD] This action requires your approval: ${policyDecision.reason}. ` +
                        `Tool "${fc.name}" was not executed. Change the policy profile in Settings to allow it.`;
                    if (!webContents.isDestroyed()) {
                        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
                            id: tcId,
                            name: uiName,
                            status: 'error',
                            detail: `Requires approval: ${policyDecision.reason}`,
                            policyHeld: true,
                        });
                    }
                    toolResultParts.push({
                        functionResponse: { name: fc.name, response: { result: resultStr } },
                    });
                    continue;
                }
                // ── End policy gate ───────────────────────────────────────────────
```

- [ ] **Step 3: Remove the evaluatePolicy import if unused**

Check if `evaluatePolicy` is imported. If no longer used, remove it.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | grep -i "geminiChat" || echo "No errors in geminiChat.ts"
```

- [ ] **Step 5: Commit**

```bash
git add src/main/geminiChat.ts
git commit -m "refactor(policy): remove dead policy gate from geminiChat.ts tool loop"
```

---

## Sub-project 2: Real Approval Flow

### Task 4: Approval Manager

**Files:**
- Create: `src/main/agent/approvalManager.ts`
- Create: `tests/renderer/agent/approvalManager.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/renderer/agent/approvalManager.test.ts
import { requestApproval, resolveApproval } from '../../../src/main/agent/approvalManager';

describe('approvalManager', () => {
  it('resolveApproval resolves the pending promise with approved', async () => {
    const promise = requestApproval('test-1');
    resolveApproval('test-1', 'approved');
    expect(await promise).toBe('approved');
  });

  it('resolveApproval resolves the pending promise with denied', async () => {
    const promise = requestApproval('test-2');
    resolveApproval('test-2', 'denied');
    expect(await promise).toBe('denied');
  });

  it('resolveApproval returns false for unknown approvalId', () => {
    expect(resolveApproval('no-such-id', 'approved')).toBe(false);
  });

  it('resolveApproval returns true for known approvalId', async () => {
    const promise = requestApproval('test-3');
    expect(resolveApproval('test-3', 'approved')).toBe(true);
    await promise;
  });

  it('second resolve for same id returns false', async () => {
    const promise = requestApproval('test-4');
    resolveApproval('test-4', 'approved');
    await promise;
    expect(resolveApproval('test-4', 'denied')).toBe(false);
  });

  it('times out and auto-denies after APPROVAL_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    const promise = requestApproval('test-timeout');
    vi.advanceTimersByTime(5 * 60 * 1000); // 5 minutes
    expect(await promise).toBe('denied');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/renderer/agent/approvalManager.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Create approvalManager.ts**

```typescript
// src/main/agent/approvalManager.ts

const pending = new Map<string, (decision: 'approved' | 'denied') => void>();

export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function requestApproval(approvalId: string): Promise<'approved' | 'denied'> {
  return new Promise((resolve) => {
    pending.set(approvalId, resolve);
    setTimeout(() => {
      if (pending.has(approvalId)) {
        pending.delete(approvalId);
        resolve('denied');
      }
    }, APPROVAL_TIMEOUT_MS);
  });
}

export function resolveApproval(approvalId: string, decision: 'approved' | 'denied'): boolean {
  const resolve = pending.get(approvalId);
  if (!resolve) return false;
  pending.delete(approvalId);
  resolve(decision);
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/renderer/agent/approvalManager.test.ts 2>&1 | tail -20
```

Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/approvalManager.ts tests/renderer/agent/approvalManager.test.ts
git commit -m "feat(policy): add approvalManager — pending approval promise registry with timeout"
```

---

### Task 5: Add ApprovalInfo type + extend DispatchContext and LoopOptions

**Files:**
- Modify: `src/main/agent/types.ts`

- [ ] **Step 1: Add ApprovalInfo and extend interfaces**

At the bottom of `src/main/agent/types.ts`, before the closing `ToolUseBlock` interface, add `ApprovalInfo`. Then extend `DispatchContext` and `LoopOptions`.

Add after `ToolUseBlock`:

```typescript
export interface ApprovalInfo {
  toolName: string;
  inputSummary: string;
  reason: string;
  ruleId?: string;
  profileName: string;
}
```

Add `requestApproval` to the `DispatchContext` interface:

```typescript
export interface DispatchContext {
  runId: string;
  signal: AbortSignal;
  iterationIndex: number;
  toolCallCount: number;
  allToolCalls: ToolCallRecord[];
  browserBudget: BrowserBudgetState;
  options: LoopOptions;
  requestApproval?: (approvalId: string, info: ApprovalInfo) => void;
}
```

Add `onApprovalRequested` to the `LoopOptions` interface:

```typescript
export interface LoopOptions {
  provider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;
  model: string;
  runId: string;
  maxIterations?: number;
  signal?: AbortSignal;
  forcedProfile?: Partial<AgentProfile>;
  unrestrictedMode?: boolean;
  browserService?: BrowserService;
  onText: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolActivity?: (activity: ToolActivity) => void;
  onApprovalRequested?: (approvalId: string, info: ApprovalInfo) => void;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/agent/types.ts
git commit -m "feat(policy): add ApprovalInfo type, extend DispatchContext + LoopOptions"
```

---

### Task 6: Wire approval into dispatch.ts

**Files:**
- Modify: `src/main/agent/dispatch.ts`

- [ ] **Step 1: Add requestApproval import**

At the top of `src/main/agent/dispatch.ts`, add:

```typescript
import { requestApproval } from './approvalManager';
```

Also update the types import to include `ApprovalInfo`:

```typescript
import type { DispatchContext, ToolUseBlock, ToolCallRecord, ApprovalInfo } from './types';
```

- [ ] **Step 2: Replace the require_approval stub with real approval flow**

In `executeOne()`, replace the `require_approval` block:

```typescript
  if (decision.effect === 'require_approval') {
    const msg = `[POLICY HELD] ${decision.reason} — tool "${block.name}" was not executed. Change the policy profile in Settings to allow it.`;
    options.onToolActivity?.({ id: block.id, name: block.name, status: 'error', detail: msg });
    return msg;
  }
```

With:

```typescript
  if (decision.effect === 'require_approval') {
    const approvalId = `approval-${block.id}-${Date.now()}`;

    options.onToolActivity?.({
      id: block.id,
      name: block.name,
      status: 'running',
      detail: `Awaiting approval: ${decision.reason}`,
    });

    ctx.requestApproval?.(approvalId, {
      toolName: block.name,
      inputSummary: JSON.stringify(block.input).slice(0, 200),
      reason: decision.reason,
      ruleId: decision.ruleId ?? undefined,
      profileName: decision.profileName,
    });

    const userDecision = await requestApproval(approvalId);

    if (userDecision === 'denied') {
      const msg = `[APPROVAL DENIED] Tool "${block.name}" was not executed.`;
      options.onToolActivity?.({ id: block.id, name: block.name, status: 'error', detail: msg });
      return msg;
    }

    // Approved — fall through to normal execution below
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/dispatch.ts
git commit -m "feat(policy): real approval flow in dispatch — requestApproval + await"
```

---

### Task 7: Wire approval into agentLoop + IPC

**Files:**
- Modify: `src/main/agent/agentLoop.ts`
- Modify: `src/main/ipc-channels.ts`
- Modify: `src/main/registerIpc.ts`

- [ ] **Step 1: Wire requestApproval callback into agentLoop.ts DispatchContext**

In `src/main/agent/agentLoop.ts`, find the `ctx: DispatchContext` construction (around line 28). Add the `requestApproval` field:

```typescript
  const ctx: DispatchContext = {
    runId,
    signal: control.signal,
    iterationIndex: 0,
    toolCallCount: 0,
    allToolCalls: [],
    browserBudget: initBrowserBudget(),
    options,
    requestApproval: (approvalId, info) => {
      options.onApprovalRequested?.(approvalId, info);
    },
  };
```

- [ ] **Step 2: Add IPC channels**

In `src/main/ipc-channels.ts`, add to the `IPC` object (after `POLICY_LIST`):

```typescript
  POLICY_APPROVAL_RESPOND: 'policy:approval-respond',
  POLICY_AUDIT_LOG: 'policy:audit-log',
```

Add to the `IPC_EVENTS` object:

```typescript
  POLICY_APPROVAL_REQUESTED: 'policy:approval-requested',
```

- [ ] **Step 3: Wire IPC handlers in registerIpc.ts**

Add import at the top of `src/main/registerIpc.ts`:

```typescript
import { resolveApproval } from './agent/approvalManager';
import { getRecentPolicyAudit } from './db/policies';
```

In the `agentLoop()` call inside `CHAT_SEND`, add `onApprovalRequested` to the options object (alongside `onText`, `onThinking`, `onToolActivity`):

```typescript
        onApprovalRequested: (approvalId, info) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_EVENTS.POLICY_APPROVAL_REQUESTED, { approvalId, ...info });
          }
        },
```

After the existing `POLICY_LIST` handler, add:

```typescript
  ipcMain.handle(IPC.POLICY_APPROVAL_RESPOND, (_e, approvalId: string, decision: 'approved' | 'denied') => {
    resolveApproval(approvalId, decision);
  });

  ipcMain.handle(IPC.POLICY_AUDIT_LOG, (_e, limit?: number) => {
    return getRecentPolicyAudit(limit ?? 50);
  });
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | grep -E "agentLoop|ipc-channels|registerIpc" || echo "No errors"
```

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/agentLoop.ts src/main/ipc-channels.ts src/main/registerIpc.ts
git commit -m "feat(policy): wire approval IPC — POLICY_APPROVAL_REQUESTED/RESPOND + AUDIT_LOG"
```

---

## Sub-project 3: Policy UI

### Task 8: ApprovalCard component

**Files:**
- Create: `src/renderer/components/ApprovalCard.tsx`

- [ ] **Step 1: Create ApprovalCard.tsx**

```tsx
// src/renderer/components/ApprovalCard.tsx
import React from 'react';

export interface PendingApproval {
  approvalId: string;
  toolName: string;
  inputSummary: string;
  reason: string;
  ruleId?: string;
  profileName: string;
}

interface ApprovalCardProps {
  approval: PendingApproval;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}

export default function ApprovalCard({ approval, onApprove, onDeny }: ApprovalCardProps) {
  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3 my-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-amber-400 text-xs font-semibold uppercase tracking-wide">Approval Required</span>
        <span className="text-2xs text-text-muted">· {approval.profileName}</span>
      </div>
      <div className="text-[13px] text-text-primary font-medium">{approval.toolName}</div>
      <div className="mt-1 text-[13px] text-text-secondary">{approval.reason}</div>
      {approval.inputSummary && (
        <div className="mt-2 text-2xs text-text-muted font-mono bg-white/[0.03] rounded-lg px-3 py-2 break-all max-h-20 overflow-y-auto">
          {approval.inputSummary}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => onApprove(approval.approvalId)}
          className="text-2xs px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors cursor-pointer font-medium"
        >
          Approve
        </button>
        <button
          onClick={() => onDeny(approval.approvalId)}
          className="text-2xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer font-medium"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/ApprovalCard.tsx
git commit -m "feat(policy): add ApprovalCard component — inline approve/deny card"
```

---

### Task 9: Wire ApprovalCard into ChatPanel

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`

- [ ] **Step 1: Read ChatPanel.tsx to understand the structure**

Read the full file to understand where messages are rendered and where IPC listeners are set up. Look for `useEffect` blocks that call `window.electronAPI.on(...)` or `ipcRenderer.on(...)`.

- [ ] **Step 2: Add imports and state**

At the top of `ChatPanel.tsx`, add:

```typescript
import ApprovalCard, { type PendingApproval } from './ApprovalCard';
```

Inside the `ChatPanel` component function, add state:

```typescript
const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
```

- [ ] **Step 3: Add IPC listener for approval requests**

Find the `useEffect` that sets up IPC event listeners (for `CHAT_STREAM_TEXT`, `CHAT_TOOL_ACTIVITY`, etc.). Add a listener alongside those:

```typescript
const handleApprovalRequest = (_e: any, data: PendingApproval) => {
  setPendingApprovals(prev => [...prev, data]);
};
window.electronAPI?.on('policy:approval-requested', handleApprovalRequest);
```

And in the cleanup:

```typescript
window.electronAPI?.off('policy:approval-requested', handleApprovalRequest);
```

- [ ] **Step 4: Add approval response handlers**

```typescript
const handleApprovalRespond = useCallback((approvalId: string, decision: 'approved' | 'denied') => {
  window.electronAPI?.invoke('policy:approval-respond', approvalId, decision);
  setPendingApprovals(prev => prev.filter(a => a.approvalId !== approvalId));
}, []);
```

- [ ] **Step 5: Render ApprovalCards in the message stream**

Find where messages are mapped/rendered (the `.map()` over `messages` array). After the message list, before the input bar, render pending approvals:

```tsx
{pendingApprovals.map(a => (
  <ApprovalCard
    key={a.approvalId}
    approval={a}
    onApprove={(id) => handleApprovalRespond(id, 'approved')}
    onDeny={(id) => handleApprovalRespond(id, 'denied')}
  />
))}
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx
git commit -m "feat(policy): wire ApprovalCard into ChatPanel — listen for requests, render inline"
```

---

### Task 10: PolicyPanel component

**Files:**
- Create: `src/renderer/components/PolicyPanel.tsx`

- [ ] **Step 1: Create PolicyPanel.tsx**

```tsx
// src/renderer/components/PolicyPanel.tsx
import React, { useState, useEffect } from 'react';

interface PolicyProfile {
  id: string;
  name: string;
  scopeType: string;
}

interface AuditEntry {
  toolName: string;
  effect: string;
  reason?: string;
  ruleId?: string;
  profileId: string;
  created_at?: string;
}

const PROFILE_DESCRIPTIONS: Record<string, string> = {
  standard: 'Flags destructive shell commands and sensitive file edits',
  coding: 'Stricter: blocks force-push and DROP TABLE, flags package installs',
  browser: 'Flags form submissions, account actions, and payment flows',
  locked: 'Flags all shell and file write operations',
  paranoid: 'Blocks all shell, file write, and browser mutation tools',
};

export default function PolicyPanel() {
  const [profiles, setProfiles] = useState<PolicyProfile[]>([]);
  const [activeId, setActiveId] = useState<string>('standard');
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    window.electronAPI?.invoke('policy:list').then((p: PolicyProfile[]) => setProfiles(p));
    window.electronAPI?.invoke('settings:get-policy-profile').then((id: string) => {
      if (id) setActiveId(id);
    });
  }, []);

  const handleSelect = (id: string) => {
    setActiveId(id);
    window.electronAPI?.invoke('settings:set-policy-profile', id);
  };

  const loadAuditLog = () => {
    if (!showAudit) {
      window.electronAPI?.invoke('policy:audit-log', 50).then((log: AuditEntry[]) => setAuditLog(log));
    }
    setShowAudit(!showAudit);
  };

  const effectBadge = (effect: string) => {
    if (effect === 'allow') return <span className="text-emerald-400 text-2xs font-medium">allow</span>;
    if (effect === 'deny') return <span className="text-red-400 text-2xs font-medium">deny</span>;
    return <span className="text-amber-400 text-2xs font-medium">held</span>;
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[13px] font-medium text-text-primary mb-2">Policy Profile</div>
        <div className="space-y-1">
          {profiles.map(p => (
            <button
              key={p.id}
              onClick={() => handleSelect(p.id)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                activeId === p.id
                  ? 'bg-white/[0.08] text-text-primary'
                  : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
              }`}
            >
              <div className="text-[13px] font-medium">{p.name}</div>
              <div className="text-2xs text-text-muted">{PROFILE_DESCRIPTIONS[p.id] ?? ''}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <button
          onClick={loadAuditLog}
          className="text-2xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        >
          {showAudit ? 'Hide audit log' : 'Show audit log'}
        </button>

        {showAudit && (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.02]">
            {auditLog.length === 0 ? (
              <div className="text-2xs text-text-muted px-3 py-4 text-center">No audit entries yet</div>
            ) : (
              <table className="w-full text-2xs">
                <thead>
                  <tr className="text-text-muted border-b border-white/[0.06]">
                    <th className="px-3 py-2 text-left font-medium">Tool</th>
                    <th className="px-3 py-2 text-left font-medium">Effect</th>
                    <th className="px-3 py-2 text-left font-medium">Rule</th>
                    <th className="px-3 py-2 text-left font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((entry, i) => (
                    <tr key={i} className="border-b border-white/[0.03]">
                      <td className="px-3 py-1.5 text-text-primary font-mono">{entry.toolName}</td>
                      <td className="px-3 py-1.5">{effectBadge(entry.effect)}</td>
                      <td className="px-3 py-1.5 text-text-muted">{entry.ruleId ?? '—'}</td>
                      <td className="px-3 py-1.5 text-text-muted truncate max-w-[200px]">{entry.reason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/PolicyPanel.tsx
git commit -m "feat(policy): add PolicyPanel — profile switcher + audit log viewer"
```

---

### Task 11: Build + Smoke Test

- [ ] **Step 1: Run all agent tests**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/renderer/agent/ --reporter=verbose 2>&1 | tail -40
```

Expected: All tests pass (including new approvalManager tests).

- [ ] **Step 2: TypeScript build check**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Check for new errors only (pre-existing renderer errors can be ignored).

- [ ] **Step 3: Fix any issues**

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(policy): resolve build/test issues in policy engine implementation"
```
