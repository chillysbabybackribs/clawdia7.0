# Conversation Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist all conversations and messages to disk so they survive app restarts, with activity lines (shimmer labels) saved per-message and auto-pruning of conversations older than 30 days.

**Architecture:** A new `ConversationStore` class owns all file I/O — one JSON file per conversation in `<userData>/conversations/`, plus an `index.json` for fast list queries. `RuntimeCoordinator` calls `ConversationStore` on create/update/delete and loads from it on startup. Activity lines accumulated during a run are captured from `tool_event` events and frozen into the assistant message on run completion. The `InlineShimmer` + `StatusLine` components already exist and are wired; the only UI change is persisting `activityLines` on the `Message` type and rendering them frozen above the assistant response.

**Tech Stack:** Node.js `fs` (sync, matching `SettingsStore` pattern), Electron `app.getPath('userData')`, TypeScript, React.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/main/core/runtime/ConversationStore.ts` | **Create** | All conversation file I/O: save, load, list, delete, prune |
| `src/main/core/runtime/RuntimeCoordinator.ts` | **Modify** | Wire ConversationStore; collect activityLines during run; freeze into assistant message |
| `src/shared/types.ts` | **Modify** | Add `activityLines?: string[]` to `Message` interface |
| `src/renderer/components/ChatPanel.tsx` | **Modify** | Render frozen `activityLines` above completed assistant messages; update `toolToShimmerLabel` for new tab tools |
| `src/renderer/index.css` | **Modify** | Add `.activity-log` styles for frozen dimmed activity lines above assistant message |

---

## Task 1: Add `activityLines` to `Message` type

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the field**

In `src/shared/types.ts`, find the `Message` interface and add one field after `toolCalls`:

```typescript
  toolCalls?: ToolCall[];
  activityLines?: string[];   // agent activity labels, frozen on run completion
```

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
cd /home/dp/Desktop/clawdia5.0 && npx tsc --noEmit 2>&1 | grep -v "ProcessesPanel\|AgentBuilderShell\|AgentDetailPanel\|TasksDrawer"
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add activityLines to Message"
```

---

## Task 2: Create `ConversationStore`

**Files:**
- Create: `src/main/core/runtime/ConversationStore.ts`

This class mirrors the pattern of `SettingsStore` and `ElectronBrowserService` tab persistence.

- [ ] **Step 1: Create the file**

```typescript
// src/main/core/runtime/ConversationStore.ts
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { Message } from '../../../shared/types';
import type { RunMode } from '../../../core/types/runtime';

export interface PersistedConversation {
  id: string;
  title: string;
  updatedAt: string;
  mode: RunMode;
  claudeTerminalStatus: 'idle' | 'starting' | 'ready' | 'working' | 'errored' | 'stopped';
  activeTerminalSessionId: string | null;
  messages: Message[];
}

export interface ConversationIndexEntry {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  mode: RunMode;
}

const PRUNE_DAYS = 30;

export class ConversationStore {
  private readonly dir: string;
  private readonly indexPath: string;

  constructor() {
    this.dir = path.join(app.getPath('userData'), 'conversations');
    this.indexPath = path.join(this.dir, 'index.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.pruneOld();
  }

  /** Load all index entries (metadata only, no messages). */
  loadIndex(): ConversationIndexEntry[] {
    try {
      if (!fs.existsSync(this.indexPath)) return [];
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) as ConversationIndexEntry[];
    } catch {
      return [];
    }
  }

  /** Load a single conversation with its messages. Returns null if not found. */
  loadConversation(id: string): PersistedConversation | null {
    const filePath = this.convPath(id);
    try {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PersistedConversation;
    } catch {
      return null;
    }
  }

  /** Save (create or update) a conversation. Updates the index. */
  save(conv: PersistedConversation): void {
    const filePath = this.convPath(conv.id);
    // Strip renderer-only fields before persisting
    const toWrite: PersistedConversation = {
      ...conv,
      messages: conv.messages.map(m => {
        const { feed, isStreaming, ...rest } = m as any;
        return rest;
      }),
    };
    fs.writeFileSync(filePath, JSON.stringify(toWrite, null, 2), 'utf8');
    this.updateIndex(conv);
  }

  /** Delete a conversation file and remove from index. */
  delete(id: string): void {
    const filePath = this.convPath(id);
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
    this.removeFromIndex(id);
  }

  private convPath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private updateIndex(conv: PersistedConversation): void {
    const entries = this.loadIndex().filter(e => e.id !== conv.id);
    entries.push({
      id: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
      messageCount: conv.messages.length,
      mode: conv.mode,
    });
    fs.writeFileSync(this.indexPath, JSON.stringify(entries, null, 2), 'utf8');
  }

  private removeFromIndex(id: string): void {
    const entries = this.loadIndex().filter(e => e.id !== id);
    fs.writeFileSync(this.indexPath, JSON.stringify(entries, null, 2), 'utf8');
  }

  private pruneOld(): void {
    const cutoff = Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1000;
    const entries = this.loadIndex();
    const toKeep: ConversationIndexEntry[] = [];
    for (const entry of entries) {
      if (Date.parse(entry.updatedAt) < cutoff) {
        try { fs.unlinkSync(this.convPath(entry.id)); } catch { /* already gone */ }
      } else {
        toKeep.push(entry);
      }
    }
    if (toKeep.length !== entries.length) {
      fs.writeFileSync(this.indexPath, JSON.stringify(toKeep, null, 2), 'utf8');
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/dp/Desktop/clawdia5.0 && npx tsc --noEmit 2>&1 | grep -v "ProcessesPanel\|AgentBuilderShell\|AgentDetailPanel\|TasksDrawer"
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/core/runtime/ConversationStore.ts
git commit -m "feat(persistence): add ConversationStore with 30-day pruning"
```

---

## Task 3: Wire `ConversationStore` into `RuntimeCoordinator`

**Files:**
- Modify: `src/main/core/runtime/RuntimeCoordinator.ts`

Four changes: (1) inject and load from store on startup, (2) save on create/update, (3) delete via store, (4) collect activityLines during run and freeze into assistant message.

- [ ] **Step 1: Import and construct the store**

At the top of `RuntimeCoordinator.ts`, add the import:
```typescript
import { ConversationStore } from './ConversationStore';
import type { PersistedConversation } from './ConversationStore';
```

Add the field to the class:
```typescript
private readonly store: ConversationStore;
```

In the constructor, after `this.cliBlockExecutor = ...`:
```typescript
this.store = new ConversationStore();
this.loadPersistedConversations();
```

- [ ] **Step 2: Add `loadPersistedConversations` private method**

Add after the constructor:
```typescript
private loadPersistedConversations(): void {
  const entries = this.store.loadIndex();
  for (const entry of entries) {
    // Load metadata into the map lazily — full messages loaded on demand
    this.conversations.set(entry.id, {
      id: entry.id,
      title: entry.title,
      updatedAt: entry.updatedAt,
      messages: [],          // loaded lazily on loadConversation()
      mode: entry.mode,
      claudeTerminalStatus: 'idle',
      activeTerminalSessionId: null,
    });
  }
}
```

- [ ] **Step 3: Persist on create**

In `createConversation()`, after `this.conversations.set(id, conversation)`:
```typescript
this.store.save(conversation);
```

- [ ] **Step 4: Load full messages lazily in `loadConversation`**

Replace the body of `loadConversation(id)` with:
```typescript
loadConversation(id: string): { ... } | null {
  const inMemory = this.conversations.get(id);
  if (!inMemory) return null;

  // If messages not yet loaded, pull from disk
  if (inMemory.messages.length === 0) {
    const persisted = this.store.loadConversation(id);
    if (persisted) {
      inMemory.messages = persisted.messages;
    }
  }

  this.activeConversationId = id;
  return {
    id,
    messages: inMemory.messages,
    mode: inMemory.mode,
    claudeTerminalStatus: inMemory.claudeTerminalStatus,
    claudeTerminalSessionId: inMemory.activeTerminalSessionId,
  };
}
```

- [ ] **Step 5: Persist on delete**

In `deleteConversation(id)`:
```typescript
deleteConversation(id: string): { ok: boolean } {
  const deleted = this.conversations.delete(id);
  if (deleted) this.store.delete(id);
  if (this.activeConversationId === id) this.activeConversationId = null;
  return { ok: deleted };
}
```

- [ ] **Step 6: Collect activityLines during run, freeze into assistant message**

In `RuntimeCoordinator`, add a private map for collecting activity lines per run:
```typescript
private readonly runActivityLines = new Map<string, string[]>();
```

In `sendMessage()`, before `await new Promise<void>((resolve) => {`, add:
```typescript
this.runActivityLines.set(runId, []);
```

Inside the `executor.subscribe` callback, add handling for `tool_event`:
```typescript
if (event.type === 'tool_event' && event.status === 'running') {
  const label = this.toolEventToActivityLabel(event.toolName, event.detail);
  if (label) {
    const lines = this.runActivityLines.get(runId);
    if (lines) lines.push(label);
  }
}
```

After building `assistantMessage`, attach collected lines:
```typescript
const activityLines = this.runActivityLines.get(runId) ?? [];
this.runActivityLines.delete(runId);
const assistantMessage: Message = {
  id: this.makeId('msg'),
  role: 'assistant',
  content: completion,
  timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  activityLines: activityLines.length > 0 ? activityLines : undefined,
};
```

After `conversation.messages.push(assistantMessage)`, save to disk:
```typescript
this.store.save(conversation);
```

Also save after appending the user message (so in-progress titles survive crashes). After `conversation.updatedAt = new Date().toISOString()` (the second one, after title update):
```typescript
this.store.save(conversation);
```

- [ ] **Step 7: Add `toolEventToActivityLabel` private method**

```typescript
private toolEventToActivityLabel(toolName: string, detail?: string): string | null {
  // Mirror the logic in ChatPanel.tsx toolToShimmerLabel
  const urlMatch = detail?.match(/https?:\/\/([^/\s"]+)/);
  const host = urlMatch ? urlMatch[1].replace(/^www\./, '') : null;

  switch (toolName) {
    case 'browser.navigate':   return host ? `Navigated to ${host}` : 'Navigated';
    case 'browser.new_tab':    return host ? `Opened tab: ${host}` : 'Opened new tab';
    case 'browser.switch_tab': return 'Switched tab';
    case 'browser.close_tab':  return 'Closed tab';
    case 'browser.extract_text': return 'Read page text';
    case 'browser.screenshot': return 'Took screenshot';
    case 'browser.click':      return 'Clicked element';
    case 'browser.type':       return 'Typed into field';
    case 'browser.find_elements': return 'Inspected page elements';
    case 'browser.evaluate_js': return 'Ran page script';
    case 'shell.exec': {
      const cmd = detail ? String(detail).slice(0, 40) : '';
      return cmd ? `Ran: ${cmd}` : 'Ran shell command';
    }
    case 'fs.read_file': {
      const filePart = detail ? path.basename(String(detail)) : '';
      return filePart ? `Read ${filePart}` : 'Read file';
    }
    default: return null;
  }
}
```

Note: `path` is already imported at the top of `ConversationStore.ts`; add `import * as path from 'path';` to `RuntimeCoordinator.ts` if not present.

- [ ] **Step 8: Also persist on mode change**

In `setConversationMode()`, after the final `return` block is assembled, add:
```typescript
this.store.save({ ...conversation });
```
(Right before the `return` statement.)

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd /home/dp/Desktop/clawdia5.0 && npx tsc --noEmit 2>&1 | grep -v "ProcessesPanel\|AgentBuilderShell\|AgentDetailPanel\|TasksDrawer"
```
Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
git add src/main/core/runtime/RuntimeCoordinator.ts
git commit -m "feat(persistence): wire ConversationStore into RuntimeCoordinator; collect activityLines per run"
```

---

## Task 4: Render frozen activity lines in ChatPanel

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`
- Modify: `src/renderer/index.css`

Frozen activity lines appear above the assistant response text, dimmed, one line per row, no shimmer (shimmer is only for live lines).

- [ ] **Step 1: Add CSS for frozen activity log**

In `src/renderer/index.css`, after the `.inline-shimmer` block (around line 179), add:

```css
/* ── Frozen activity log (persisted, shown above assistant response) ── */
.activity-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 6px;
}
.activity-log-line {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.32);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}
```

- [ ] **Step 2: Add `FrozenActivityLog` component in ChatPanel**

After the `InlineShimmer` function (around line 476), add:

```tsx
function FrozenActivityLog({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div className="activity-log">
      {lines.map((line, i) => (
        <span key={i} className="activity-log-line">{line}</span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Render `FrozenActivityLog` in `AssistantMessage`**

In the `AssistantMessage` component, in the completed path (the `else` branch that renders `message.content`), add `FrozenActivityLog` before the content. Find the block that renders the final message (around line 410-440, look for `message.content` render). Add above the content render:

```tsx
{message.activityLines && message.activityLines.length > 0 && (
  <FrozenActivityLog lines={message.activityLines} />
)}
```

- [ ] **Step 4: Update `toolToShimmerLabel` for new tab tools**

In the `toolToShimmerLabel` function (around line 448), add cases for the new tab tools:

```typescript
  if (name === 'browser.new_tab') {
    const host = extractHostname(detail ?? '');
    return host ? `Opening tab: ${host}…` : 'Opening new tab…';
  }
  if (name === 'browser.switch_tab') return 'Switching tab…';
  if (name === 'browser.close_tab') return 'Closing tab…';
  if (name === 'browser.list_tabs') return 'Checking open tabs…';
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /home/dp/Desktop/clawdia5.0 && npx tsc --noEmit 2>&1 | grep -v "ProcessesPanel\|AgentBuilderShell\|AgentDetailPanel\|TasksDrawer"
```
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx src/renderer/index.css
git commit -m "feat(ui): render frozen activity lines above completed assistant messages"
```

---

## Task 5: Smoke test end-to-end

- [ ] **Step 1: Build and run the app**

```bash
cd /home/dp/Desktop/clawdia5.0 && npm run dev
```

- [ ] **Step 2: Send a message that uses tools**

Type a message like "navigate to example.com and tell me the page title". Verify:
- Shimmer line appears and cross-fades as the agent works
- After response arrives, activity lines appear above the response (dimmed, small)

- [ ] **Step 3: Restart the app**

Close and reopen. Verify:
- Conversation appears in the sidebar list
- Clicking it loads the full message history
- Frozen activity lines are still visible above the assistant response

- [ ] **Step 4: Verify conversation files on disk**

```bash
ls -la ~/.config/Clawdia/conversations/
cat ~/.config/Clawdia/conversations/index.json
```
Expected: `index.json` with entries, one `.json` file per conversation.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: conversation + activity line persistence across restarts"
```
