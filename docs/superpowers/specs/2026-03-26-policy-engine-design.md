# Policy Engine Design

**Date:** 2026-03-26
**Status:** Approved

---

## Overview

7.0 already has a solid policy engine (`src/main/agent/policy-engine.ts`) — superior to 4.0 in rule priority, audit logging, and profile coverage. The gaps are:

1. **Policy is applied in the old `*Chat.ts` tool loops**, which are now dead code. The new `agentLoop` → `dispatch.ts` path has no policy gate.
2. **`require_approval` is a stub** — it blocks the tool but never lets the user approve/deny in real time.
3. **No UI** for switching policy profiles, viewing the audit log, or responding to approval requests.

This spec covers all three gaps across three sub-projects that build on each other in order.

---

## Sub-project 1: Policy Gate in `dispatch.ts`

### Problem

`dispatch.ts` → `executeOne()` → `routeToolExecution()` executes tools with no policy check. The policy blocks in `anthropicChat.ts` (lines ~264–308) and `geminiChat.ts` (lines ~227–268) are unreachable dead code — `agentLoop` calls `dispatch.ts` directly and never goes through those old tool loops.

### Solution

Move policy evaluation into `executeOne()` in `dispatch.ts`, immediately before `routeToolExecution`. Remove the dead policy blocks from `anthropicChat.ts` and `geminiChat.ts`.

### Changes

**`src/main/agent/dispatch.ts` — add policy gate to `executeOne()`:**

```typescript
async function executeOne(block: ToolUseBlock, ctx: DispatchContext): Promise<string> {
  if (ctx.signal.aborted) return JSON.stringify({ ok: false, error: 'Cancelled' });

  const { options } = ctx;

  // Policy gate — runs before any tool execution
  const decision = evaluatePolicy(block.name, block.input, { runId: ctx.runId });

  if (decision.effect === 'deny') {
    const msg = `[POLICY DENIED] ${decision.reason} (rule: ${decision.ruleId ?? 'none'}, profile: ${decision.profileName})`;
    options.onToolActivity?.({ id: block.id, name: block.name, status: 'error', detail: msg });
    return msg;
  }

  if (decision.effect === 'require_approval') {
    // Sub-project 2 will replace this stub with real approval flow
    const msg = `[POLICY HELD] ${decision.reason} — tool "${block.name}" was not executed. Change the policy profile in Settings to allow it.`;
    options.onToolActivity?.({ id: block.id, name: block.name, status: 'error', detail: msg });
    return msg;
  }

  // ... existing execution logic (trackToolCall, onToolActivity running, routeToolExecution, etc.)
}
```

**`src/main/anthropicChat.ts` — remove dead policy block:**

The policy check inside `executeTools()` (called only by `streamAnthropicChat`'s old tool loop) is dead. Remove the `evaluatePolicy` call and the deny/require_approval branches from `executeTools()`. The `streamAnthropicChat` non-agentic streaming path has no tool calls, so this is safe.

**`src/main/geminiChat.ts` — remove dead policy block:**

The policy gate inside `streamGeminiChat`'s tool loop (lines ~227–268) is dead — `agentLoop` owns tool dispatch now. Remove the `evaluatePolicy` call and its branches.

**`src/main/openaiChat.ts` — no change.** Never had a policy gate.

### Result

Policy applies uniformly to all three providers via `dispatch.ts`. One source of truth.

---

## Sub-project 2: Real Approval Flow

### Problem

`require_approval` currently returns a blocking message to the LLM but never pauses to wait for the user. The user has no way to approve a held tool at runtime — they have to change their policy profile in Settings, which is disruptive.

### Solution

When a tool hits `require_approval`, `dispatch.ts` emits a `POLICY_APPROVAL_REQUESTED` IPC event and awaits a promise. The renderer shows an inline approval card. The user clicks Approve or Deny. The main process resolves the promise and either executes the tool or returns a denial message.

### New File: `src/main/agent/approvalManager.ts`

```typescript
// Module-level registry of pending approval promises
const pending = new Map<string, (decision: 'approved' | 'denied') => void>();

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — auto-deny on timeout

export function requestApproval(approvalId: string): Promise<'approved' | 'denied'> {
  return new Promise((resolve) => {
    pending.set(approvalId, resolve);
    setTimeout(() => {
      if (pending.has(approvalId)) {
        pending.delete(approvalId);
        resolve('denied'); // auto-deny on timeout
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

### Changes

**`src/main/agent/dispatch.ts` — replace `require_approval` stub:**

```typescript
if (decision.effect === 'require_approval') {
  const approvalId = `approval-${block.id}-${Date.now()}`;

  // Notify renderer — show approval card in chat
  options.onToolActivity?.({
    id: block.id,
    name: block.name,
    status: 'running',
    detail: `Awaiting approval: ${decision.reason}`,
  });

  // Emit approval request to renderer via IPC (needs webContents access — see below)
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

  // Approved — fall through to normal execution
}
```

**`DispatchContext` — add `requestApproval` callback:**

```typescript
export interface DispatchContext {
  // ... existing fields ...
  requestApproval?: (approvalId: string, info: ApprovalInfo) => void;
}

export interface ApprovalInfo {
  toolName: string;
  inputSummary: string;
  reason: string;
  ruleId?: string;
  profileName: string;
}
```

**`src/main/agent/agentLoop.ts` — wire `requestApproval` into context:**

The `agentLoop` receives `webContents` (or passes through IPC via the `onToolActivity` callback). The `requestApproval` callback sends `IPC_EVENTS.POLICY_APPROVAL_REQUESTED` to the renderer.

```typescript
const ctx: DispatchContext = {
  // ... existing fields ...
  requestApproval: (approvalId, info) => {
    options.onApprovalRequested?.(approvalId, info);
  },
};
```

**`LoopOptions` — add `onApprovalRequested` callback:**

```typescript
export interface LoopOptions {
  // ... existing fields ...
  onApprovalRequested?: (approvalId: string, info: ApprovalInfo) => void;
}
```

**`src/main/registerIpc.ts`:**

1. Wire `onApprovalRequested` in the `agentLoop` call:

```typescript
onApprovalRequested: (approvalId, info) => {
  if (!event.sender.isDestroyed()) {
    event.sender.send(IPC_EVENTS.POLICY_APPROVAL_REQUESTED, { approvalId, ...info });
  }
},
```

2. Add `POLICY_APPROVAL_RESPOND` handler:

```typescript
ipcMain.handle(IPC.POLICY_APPROVAL_RESPOND, (_e, approvalId: string, decision: 'approved' | 'denied') => {
  resolveApproval(approvalId, decision);
});
```

**`src/main/ipc-channels.ts` — add new channels:**

```typescript
POLICY_APPROVAL_REQUESTED: 'policy:approval-requested',  // main → renderer (event)
POLICY_APPROVAL_RESPOND:   'policy:approval-respond',    // renderer → main (handle)
POLICY_AUDIT_LOG:          'policy:audit-log',           // renderer → main (handle)
```

### Parallel Tool Handling

Since `dispatch.ts` runs all tools in `Promise.all`, multiple tools may hit `require_approval` simultaneously. Each gets its own `approvalId`. The renderer queues them and shows one card at a time (sequentially, in order received). The main process awaits each independently — tools that don't require approval execute immediately in parallel.

---

## Sub-project 3: Policy UI

### Three UI Components

**1. Profile Switcher (inside existing Settings panel)**

A button group or dropdown showing the 5 built-in profiles with a one-line description:

| Profile | Description |
|---------|-------------|
| standard | Flags destructive shell commands and sensitive file edits |
| coding | Stricter: blocks force-push and DROP TABLE, flags package installs |
| browser | Flags form submissions, account actions, and payment flows |
| locked | Flags all shell and file write operations |
| paranoid | Blocks all shell, file write, and browser mutation tools |

IPC used: `settings:get-policy-profile` / `settings:set-policy-profile` (already wired).

**2. Audit Log Viewer (inside Settings panel, collapsed by default)**

A read-only table of the last 50 policy decisions. Columns: time, tool name, effect (badge: green allow / red deny / yellow held), rule ID, reason. Loaded via the new `POLICY_AUDIT_LOG` IPC channel which calls `getRecentPolicyAudit(50)`.

**3. Inline Approval Card (`src/renderer/components/ApprovalCard.tsx`)**

When `POLICY_APPROVAL_REQUESTED` arrives, an approval card is injected into the chat stream at the current position. It shows:
- Tool name + truncated input summary
- Policy rule reason
- **Approve** button (green) and **Deny** button (red)

Clicking either sends `POLICY_APPROVAL_RESPOND` and dismisses the card. The card is non-blocking from the UI perspective — the user can scroll the chat while a card is visible.

Multiple pending cards stack in order. Each card is keyed by `approvalId` and managed in a React state array in `ChatPanel.tsx`.

### Files

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/renderer/components/ApprovalCard.tsx` | Inline approve/deny card |
| Create | `src/renderer/components/PolicyPanel.tsx` | Profile switcher + audit log |
| Modify | `src/renderer/components/ChatPanel.tsx` | Listen for POLICY_APPROVAL_REQUESTED, render pending cards |
| Modify | `src/main/registerIpc.ts` | POLICY_AUDIT_LOG handler |
| Modify | `src/main/ipc-channels.ts` | New IPC channels (already listed in Sub-project 2) |

---

## IPC Summary

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `policy:list` | renderer → main | List all profiles (existing) |
| `policy:audit-log` | renderer → main | Fetch recent audit log entries |
| `policy:approval-requested` | main → renderer | Notify of pending approval (event) |
| `policy:approval-respond` | renderer → main | User's approve/deny decision |
| `settings:get-policy-profile` | renderer → main | Read active profile (existing) |
| `settings:set-policy-profile` | renderer → main | Set active profile (existing) |

---

## Execution Order

Sub-projects must be implemented in order:

1. **Sub-project 1** — Policy gate in `dispatch.ts`, remove dead code. No new IPC or UI.
2. **Sub-project 2** — Approval flow. Requires Sub-project 1's dispatch gate to exist.
3. **Sub-project 3** — UI. Requires Sub-project 2's IPC events to exist.

Each produces working, testable software independently.

---

## Out of Scope

- Custom policy rule authoring UI (user-defined rules)
- Workspace-scoped policy profiles (the `scopeValue` field exists in the DB but is not used)
- Persistent approval decisions ("always allow this tool")
- Policy enforcement for the Claude Terminal mode
