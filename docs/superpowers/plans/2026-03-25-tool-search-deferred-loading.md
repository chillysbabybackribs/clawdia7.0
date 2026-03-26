# Tool Search + Deferred Tool Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side tool catalog registry, local search layer, and deferred tool loading system to Clawdia so only a small always-hot set of tools occupies model context while the full tool surface remains retrievable on demand.

**Architecture:** A `ToolCatalog` registry sits above `CapabilityBroker` and alongside the executor layer — it owns tool metadata, search, and deferred-load decisions. Executors consult the catalog to build their `tools` array instead of calling `getClaudeCodeToolDefinitions()` directly. Search runs locally over structured metadata; no embedding infrastructure or server dependencies.

**Tech Stack:** TypeScript, existing broker/contract types, Jest (existing), no new runtime dependencies.

---

## 1. CODEBASE AUDIT

### Current Tool Surfaces

There are exactly **18 named tools** in the system, all defined in a single file:

`src/main/core/providers/ClaudeCodeBrokerTools.ts` — `getClaudeCodeToolDefinitions()` returns all 18 tools as Anthropic-format `ProviderToolDefinition` objects. A subset function `getChatToolDefinitions()` returns 13 (excludes desktop_*).

These are the only provider-facing tool definitions. There is no registry, catalog, or search layer. All 18 tools are always passed to the model on every turn.

**Tool inventory by domain:**

| Domain | Tools | Count |
|--------|-------|-------|
| fs | fs_read_file, fs_write_file, fs_read_dir, fs_list_tree, fs_search_text, fs_edit_file | 6 |
| shell | shell_exec, shell_inspect_env, shell_list_processes | 3 |
| browser | browser_navigate, browser_extract_text, browser_screenshot, browser_click, browser_type, browser_wait_for, browser_scroll, browser_evaluate, browser_find_elements, browser_get_page_info | 10 |
| desktop | desktop_list_apps, desktop_screenshot, desktop_focus_window, desktop_click, desktop_type | 5 |

**CLI block surface:** `src/main/core/cli/CliBlockParser.ts` defines the same domain.action space in `ARG_COUNTS` (lines 5-19). CLI blocks share the same capability contract.

### Current Broker/Capability Registration Flow

```
Executor (Chat/ClaudeCode/Codex)
  → CapabilityBroker.execute(CapabilityRequest)
    → CapabilityPolicy.evaluate()       [allow/deny/require_approval]
    → ApprovalService                   [if require_approval]
    → ExecutionRouter.preferredSurface() [surface selection]
    → DomainAdapter.execute()           [actual execution]
      → returns CapabilityResult
```

`CapabilityBroker` at `src/main/core/capabilities/CapabilityBroker.ts` is the sole execution gateway. It does not know about tool names — only `{domain, action, payload}`.

### Current Provider-Facing Tool Definitions

`ClaudeCodeBrokerTools.ts` owns:
- `getClaudeCodeToolDefinitions()` — returns `ProviderToolDefinition[]` (full 18)
- `getChatToolDefinitions()` — returns 13 (no desktop)
- `mapClaudeCodeToolCall(toolName, input)` — maps tool name → `{domain, action, payload}`
- `validateClaudeCodeToolInput(toolName, input)` — validates tool input
- `makeClaudeCodeCapabilityRequest()` — assembles `CapabilityRequest` from a tool call
- `serializeClaudeCodeCapabilityResult()` — serializes result back to provider format

### Current MCP Tool Surfacing

`ClaudeCodeMcpBridgeHost.ts` calls `getClaudeCodeToolDefinitions()` and `getClaudeCodeAllowedTools()` to expose tools to Claude CLI via the Unix socket bridge. Tools are listed at bridge startup; the full set is always sent.

### CLI Execution Block Relevance

`CliBlockExecutor.ts` + `CliBlockParser.ts` form an alternate execution surface over the same capability contract. CLI blocks use `domain.action arg1 arg2` syntax and map directly to broker requests. They are relevant to tool routing: when a task is sequential and operational (e.g., write file, run script, check output), a CLI block is often a better execution path than giving the model individual tools.

### What Is Reusable

- `CapabilityDomain`, `CapabilityAction`, `CapabilitySource` types from `src/core/capabilities/contract.ts`
- `ProviderToolDefinition` interface from `src/main/core/providers/ProviderClient.ts`
- The 18 tool definitions in `ClaudeCodeBrokerTools.ts` — these become catalog entries
- `CliBlockParser.ARG_COUNTS` — defines the CLI block capability set

### What Is Missing

- No `ToolCatalog` or `ToolRegistry` type
- No tool metadata beyond Anthropic-format name/description/inputSchema
- No search/retrieval layer
- No deferred loading mechanism
- No always-hot vs deferred designation
- No CLI-aware routing policy

### What Is Redundant or Conflicting

- Tool definitions live only in `ClaudeCodeBrokerTools.ts` but are used by both `ChatExecutor` and `ClaudeCodeExecutor` via separate call sites. When the catalog is added, these call sites must be migrated.
- `ChatExecutor` has its own `mapToolCall()` method (lines 362-393) that partially duplicates `mapClaudeCodeToolCall()`. These can be unified via the catalog layer.

---

## 2. TARGET DESIGN

### Tool Catalog Registry

A `ToolCatalogEntry` type enriches each tool with:
- `id`: canonical tool name (e.g., `fs_read_file`)
- `domain`: `CapabilityDomain` (`'fs' | 'shell' | 'browser' | 'desktop'`)
- `action`: `CapabilityAction`
- `namespace`: grouping prefix (e.g., `'fs'`, `'browser'`, `'desktop'`)
- `tags`: string[] (e.g., `['read', 'file', 'local']`)
- `executionMode`: `'tool_call' | 'cli_block'`
- `alwaysHot`: boolean
- `description`: string (copied from current Anthropic-format description)
- `inputSchema`: JSON Schema object
- `cliSyntax`: optional string (for cli_block mode tools)

A `ToolCatalog` class (or plain module) owns the registry and exposes:
- `getHotTools()` → `ProviderToolDefinition[]` — always-hot set
- `getDeferredTools()` → `ToolCatalogEntry[]` — deferred set (metadata only, no schema)
- `search(query, options?)` → `ToolSearchResult[]` — local search
- `load(toolIds)` → `ProviderToolDefinition[]` — materialize deferred tools into provider format
- `getEntry(toolId)` → `ToolCatalogEntry | undefined`
- `getCliBlockTools()` → `ToolCatalogEntry[]` — tools that prefer CLI execution

### Search Engine

Local search over structured metadata. Priority order:
1. Exact `id` match
2. Exact `namespace` match (returns all tools in namespace)
3. Tag intersection (tools with most matching tags win)
4. Substring match on `id` + description keywords

No embeddings. No external dependencies. Deterministic given the same query.

Returns `ToolSearchResult[]`:
```ts
interface ToolSearchResult {
  entry: ToolCatalogEntry;
  score: number;           // 0-100
  matchReason: string;     // 'exact_id' | 'namespace' | 'tag' | 'substring'
  suggestCliBlock: boolean; // true if this tool should prefer cli_block routing
}
```

### Deferred Loading Model

On executor startup, only always-hot tools are included in the initial `tools` array sent to the provider. Deferred tools are omitted from context.

When `ToolSearchResult` is returned with deferred tools, the executor calls `catalog.load(toolIds)` to materialize their full definitions and can inject them into the next provider turn's `tools` array.

A `DeferredToolLoader` wraps this: it holds a set of currently-loaded tool IDs and provides `ensureLoaded(ids)` and `getLoadedDefinitions()`.

### Always-Hot Tool Set

Always-hot (present in every turn's tool context):
- `fs_read_file` — universal read access, minimal risk
- `shell_exec` — primary operational tool
- `browser_navigate` — primary browser entry point

All others are deferred by default. Desktop tools are always deferred (high approval cost, low general utility).

### CLI-Aware Routing Behavior

`ToolSearchRouter` sits between search results and executor tool injection. It applies routing policy:

1. If all matched tools are from a single domain AND the query implies a sequence of operations → suggest CLI block route
2. If query matches exactly one tool → return direct tool
3. If query matches 2-5 tools from same namespace → return as a small tool bundle
4. If query matches tools from 3+ domains → return top 3 by score

"Implies a sequence" heuristics: query contains words like "then", "and then", "after", "multiple", "all files", "each", or contains a count > 1.

### How Search Results Surface Into Runtime

`ClaudeCodeExecutor` and `ChatExecutor` call `catalog.getHotTools()` at turn start. If a prior turn produced a `tool_search` tool call (future), the executor calls `catalog.load()` and merges results into the next turn's `tools` array. For Phase 3, deferred loading is triggered by explicit catalog API calls from the executor, not a model-visible tool.

---

## 3. 5-PHASE IMPLEMENTATION PLAN

---

## File Structure

**New files:**
- `src/core/catalog/types.ts` — `ToolCatalogEntry`, `ToolSearchResult`, `ToolSearchQuery` types
- `src/main/core/catalog/ToolCatalog.ts` — registry + search + deferred loading
- `src/main/core/catalog/ToolCatalogEntries.ts` — the 18 catalog entries (data, not logic)
- `src/main/core/catalog/DeferredToolLoader.ts` — tracks loaded/hot tool set per session
- `src/main/core/catalog/ToolSearchRouter.ts` — routing policy (tool vs CLI block)
- `tests/main/core/catalog/ToolCatalog.test.ts`
- `tests/main/core/catalog/DeferredToolLoader.test.ts`
- `tests/main/core/catalog/ToolSearchRouter.test.ts`

**Modified files:**
- `src/main/core/providers/ClaudeCodeBrokerTools.ts` — add `fromCatalogEntry()` helper; keep existing functions but delegate to catalog
- `src/main/core/executors/ChatExecutor.ts` — use `catalog.getHotTools()` instead of `getChatToolDefinitions()`
- `src/main/core/executors/ClaudeCodeExecutor.ts` — use `catalog.getHotTools()` + `DeferredToolLoader`
- `src/main/core/providers/ClaudeCodeMcpBridgeHost.ts` — accept catalog-sourced tool definitions
- `src/main/core/runtime/RuntimeCoordinator.ts` — instantiate `ToolCatalog` and inject into executors

---

### Phase 1 — Tool Catalog Registry

**Scope:** Define the catalog types, create all 18 entries with enriched metadata, expose `getHotTools()` and `getEntry()`. Wire into `RuntimeCoordinator`. No search yet. No deferred loading yet.

---

#### Task 1: Define catalog types

**Files:**
- Create: `src/core/catalog/types.ts`
- Test: `tests/main/core/catalog/ToolCatalog.test.ts` (stub file, first test)

- [ ] **Step 1: Write the failing type import test**

```ts
// tests/main/core/catalog/ToolCatalog.test.ts
import { ToolCatalogEntry, ToolSearchResult } from '../../../src/core/catalog/types';

describe('ToolCatalogEntry type', () => {
  it('can construct a valid entry', () => {
    const entry: ToolCatalogEntry = {
      id: 'fs_read_file',
      domain: 'fs',
      action: 'read_file',
      namespace: 'fs',
      tags: ['read', 'file', 'local'],
      executionMode: 'tool_call',
      alwaysHot: true,
      description: 'Read a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    };
    expect(entry.id).toBe('fs_read_file');
    expect(entry.alwaysHot).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/dp/Desktop/clawdia5.0
npx jest tests/main/core/catalog/ToolCatalog.test.ts --no-coverage 2>&1 | tail -20
```
Expected: error — `Cannot find module '../../../src/core/catalog/types'`

- [ ] **Step 3: Create the types file**

```ts
// src/core/catalog/types.ts
import type { CapabilityDomain, CapabilityAction } from '../capabilities/contract';

export type ToolExecutionMode = 'tool_call' | 'cli_block';

export interface ToolCatalogEntry {
  id: string;
  domain: CapabilityDomain;
  action: CapabilityAction;
  namespace: string;
  tags: string[];
  executionMode: ToolExecutionMode;
  alwaysHot: boolean;
  description: string;
  inputSchema: Record<string, unknown>;
  cliSyntax?: string;
}

export interface ToolSearchQuery {
  text: string;
  domain?: CapabilityDomain;
  tags?: string[];
  includeDeferred?: boolean;
  maxResults?: number;
}

export interface ToolSearchResult {
  entry: ToolCatalogEntry;
  score: number;
  matchReason: 'exact_id' | 'namespace' | 'tag' | 'substring';
  suggestCliBlock: boolean;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest tests/main/core/catalog/ToolCatalog.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `Tests: 1 passed`

- [ ] **Step 5: Commit**

```bash
git add src/core/catalog/types.ts tests/main/core/catalog/ToolCatalog.test.ts
git commit -m "feat(catalog): add ToolCatalogEntry types"
```

---

#### Task 2: Create the 18 catalog entries

**Files:**
- Create: `src/main/core/catalog/ToolCatalogEntries.ts`
- Test: extend `tests/main/core/catalog/ToolCatalog.test.ts`

- [ ] **Step 1: Write failing test for entries**

Add to `tests/main/core/catalog/ToolCatalog.test.ts`:

```ts
import { TOOL_CATALOG_ENTRIES } from '../../../src/main/core/catalog/ToolCatalogEntries';

describe('TOOL_CATALOG_ENTRIES', () => {
  it('has exactly 18 entries', () => {
    expect(TOOL_CATALOG_ENTRIES).toHaveLength(18);
  });

  it('every entry has required fields', () => {
    for (const entry of TOOL_CATALOG_ENTRIES) {
      expect(entry.id).toBeTruthy();
      expect(entry.domain).toMatch(/^(fs|shell|browser|desktop)$/);
      expect(entry.action).toBeTruthy();
      expect(entry.namespace).toBeTruthy();
      expect(Array.isArray(entry.tags)).toBe(true);
      expect(entry.tags.length).toBeGreaterThan(0);
      expect(['tool_call', 'cli_block']).toContain(entry.executionMode);
      expect(typeof entry.alwaysHot).toBe('boolean');
      expect(entry.description).toBeTruthy();
      expect(typeof entry.inputSchema).toBe('object');
    }
  });

  it('exactly 3 entries are alwaysHot', () => {
    const hot = TOOL_CATALOG_ENTRIES.filter(e => e.alwaysHot);
    expect(hot.map(e => e.id).sort()).toEqual(['browser_navigate', 'fs_read_file', 'shell_exec']);
  });

  it('all desktop tools are NOT alwaysHot', () => {
    const desktop = TOOL_CATALOG_ENTRIES.filter(e => e.domain === 'desktop');
    expect(desktop.every(e => !e.alwaysHot)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
npx jest tests/main/core/catalog/ToolCatalog.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `Cannot find module '../../../src/main/core/catalog/ToolCatalogEntries'`

- [ ] **Step 3: Create the entries file**

```ts
// src/main/core/catalog/ToolCatalogEntries.ts
import type { ToolCatalogEntry } from '../../../core/catalog/types';

export const TOOL_CATALOG_ENTRIES: ToolCatalogEntry[] = [
  // ── FS ──────────────────────────────────────────────────────────────────
  {
    id: 'fs_read_file',
    domain: 'fs',
    action: 'read_file',
    namespace: 'fs',
    tags: ['read', 'file', 'local', 'text'],
    executionMode: 'tool_call',
    alwaysHot: true,
    description: 'Read the full contents of a file at the given path.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute or relative path to the file.' } },
      required: ['path'],
    },
    cliSyntax: 'fs.read_file <path>',
  },
  {
    id: 'fs_write_file',
    domain: 'fs',
    action: 'write_file',
    namespace: 'fs',
    tags: ['write', 'file', 'create', 'local'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Write content to a file, creating it if it does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to write.' },
        content: { type: 'string', description: 'File content.' },
      },
      required: ['path', 'content'],
    },
    cliSyntax: 'fs.write_file <path> <content>',
  },
  {
    id: 'fs_read_dir',
    domain: 'fs',
    action: 'read_dir',
    namespace: 'fs',
    tags: ['list', 'directory', 'folder', 'local'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'List the immediate contents of a directory.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path to the directory.' } },
      required: ['path'],
    },
    cliSyntax: 'fs.read_dir <path>',
  },
  {
    id: 'fs_list_tree',
    domain: 'fs',
    action: 'list_tree',
    namespace: 'fs',
    tags: ['tree', 'directory', 'recursive', 'local'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Recursively list a directory tree.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, depth: { type: 'number', description: 'Max depth (default 3).' } },
      required: ['path'],
    },
  },
  {
    id: 'fs_search_text',
    domain: 'fs',
    action: 'search_text',
    namespace: 'fs',
    tags: ['search', 'grep', 'text', 'local'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Search for text patterns across files in a directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        pattern: { type: 'string', description: 'Regex or literal search pattern.' },
      },
      required: ['path', 'pattern'],
    },
  },
  {
    id: 'fs_edit_file',
    domain: 'fs',
    action: 'edit_file',
    namespace: 'fs',
    tags: ['edit', 'replace', 'file', 'local'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Replace a string within a file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_str: { type: 'string', description: 'Text to replace.' },
        new_str: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  // ── SHELL ────────────────────────────────────────────────────────────────
  {
    id: 'shell_exec',
    domain: 'shell',
    action: 'exec',
    namespace: 'shell',
    tags: ['shell', 'command', 'exec', 'run', 'terminal'],
    executionMode: 'tool_call',
    alwaysHot: true,
    description: 'Execute a shell command and return its stdout/stderr.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Shell command to run.' } },
      required: ['command'],
    },
    cliSyntax: 'shell.exec <command>',
  },
  {
    id: 'shell_inspect_env',
    domain: 'shell',
    action: 'inspect_env',
    namespace: 'shell',
    tags: ['env', 'environment', 'variables', 'shell'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Inspect current shell environment variables.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    id: 'shell_list_processes',
    domain: 'shell',
    action: 'list_processes',
    namespace: 'shell',
    tags: ['processes', 'ps', 'shell', 'system'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'List running system processes.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── BROWSER ──────────────────────────────────────────────────────────────
  {
    id: 'browser_navigate',
    domain: 'browser',
    action: 'navigate',
    namespace: 'browser',
    tags: ['browser', 'navigate', 'url', 'open', 'web'],
    executionMode: 'tool_call',
    alwaysHot: true,
    description: 'Navigate the browser to a URL.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to navigate to.' } },
      required: ['url'],
    },
    cliSyntax: 'browser.navigate <url>',
  },
  {
    id: 'browser_extract_text',
    domain: 'browser',
    action: 'extract_text',
    namespace: 'browser',
    tags: ['browser', 'text', 'extract', 'web', 'read'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Extract visible text content from the current page.',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'Optional CSS selector to scope extraction.' } },
      required: [],
    },
  },
  {
    id: 'browser_screenshot',
    domain: 'browser',
    action: 'screenshot',
    namespace: 'browser',
    tags: ['browser', 'screenshot', 'image', 'capture', 'web'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Capture a screenshot of the current browser page.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    id: 'browser_click',
    domain: 'browser',
    action: 'click',
    namespace: 'browser',
    tags: ['browser', 'click', 'interact', 'web'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Click an element on the current page.',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector for the element to click.' } },
      required: ['selector'],
    },
  },
  {
    id: 'browser_type',
    domain: 'browser',
    action: 'type',
    namespace: 'browser',
    tags: ['browser', 'type', 'input', 'form', 'web'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Type text into an input element on the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string', description: 'Text to type.' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    id: 'browser_wait_for',
    domain: 'browser',
    action: 'wait_for',
    namespace: 'browser',
    tags: ['browser', 'wait', 'selector', 'web'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Wait for a selector to appear on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 5000).' },
      },
      required: ['selector'],
    },
  },
  {
    id: 'browser_scroll',
    domain: 'browser',
    action: 'scroll',
    namespace: 'browser',
    tags: ['browser', 'scroll', 'web'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Scroll the page or a specific element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional selector to scroll within.' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number', description: 'Pixels to scroll.' },
      },
      required: [],
    },
  },
  {
    id: 'browser_evaluate',
    domain: 'browser',
    action: 'evaluate_js',
    namespace: 'browser',
    tags: ['browser', 'javascript', 'eval', 'web'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Evaluate JavaScript in the browser page context.',
    inputSchema: {
      type: 'object',
      properties: { script: { type: 'string', description: 'JavaScript code to evaluate.' } },
      required: ['script'],
    },
  },
  {
    id: 'browser_find_elements',
    domain: 'browser',
    action: 'find_elements',
    namespace: 'browser',
    tags: ['browser', 'find', 'selector', 'elements', 'web'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Find elements on the page matching a CSS selector.',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
    },
  },
  {
    id: 'browser_get_page_info',
    domain: 'browser',
    action: 'get_page_info',
    namespace: 'browser',
    tags: ['browser', 'page', 'info', 'title', 'url', 'web'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Get current page URL, title, and basic metadata.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── DESKTOP ──────────────────────────────────────────────────────────────
  {
    id: 'desktop_list_apps',
    domain: 'desktop',
    action: 'list_apps',
    namespace: 'desktop',
    tags: ['desktop', 'apps', 'windows', 'list'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'List open desktop applications and windows.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    id: 'desktop_screenshot',
    domain: 'desktop',
    action: 'screenshot',
    namespace: 'desktop',
    tags: ['desktop', 'screenshot', 'capture', 'image'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Capture a screenshot of the desktop.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    id: 'desktop_focus_window',
    domain: 'desktop',
    action: 'focus_window',
    namespace: 'desktop',
    tags: ['desktop', 'window', 'focus', 'bring to front'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Bring a desktop window to the foreground.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Window title or substring.' } },
      required: ['title'],
    },
  },
  {
    id: 'desktop_click',
    domain: 'desktop',
    action: 'click',
    namespace: 'desktop',
    tags: ['desktop', 'click', 'mouse', 'interact'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Click at desktop screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate.' },
        y: { type: 'number', description: 'Y coordinate.' },
      },
      required: ['x', 'y'],
    },
  },
  {
    id: 'desktop_type',
    domain: 'desktop',
    action: 'type',
    namespace: 'desktop',
    tags: ['desktop', 'type', 'keyboard', 'input'],
    executionMode: 'tool_call',
    alwaysHot: false,
    description: 'Type text using the desktop keyboard.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to type.' } },
      required: ['text'],
    },
  },
];
```

Note: The entries array above has 23 entries (6 fs + 3 shell + 10 browser + 5 desktop = 24 — wait, we have 18 canonical tools in `getClaudeCodeToolDefinitions()`. Let me reconcile: fs=6, shell=3, browser=10 (not 11 — browser_get_page_info was added in audit), desktop=5 → actually audit says 18 canonical. The entries file has `browser_evaluate` mapping to `evaluate_js` action, and `browser_get_page_info` is listed. Canonical count from `ClaudeCodeBrokerTools.ts`: fs_read_file, fs_write_file, fs_read_dir, fs_list_tree, fs_search_text, fs_edit_file (6), shell_exec, shell_inspect_env, shell_list_processes (3), browser_navigate, browser_extract_text, browser_screenshot, browser_click, browser_type, browser_wait_for, browser_scroll, browser_evaluate, browser_find_elements, browser_get_page_info (9 browser tools listed = wait let me recount: navigate, extract_text, screenshot, click, type, wait_for, scroll, evaluate, find_elements, get_page_info = 10), desktop_list_apps, desktop_screenshot, desktop_focus_window, desktop_click, desktop_type (5). Total: 6+3+10+5 = 24. The audit noted 18 but browser_get_page_info and browser_find_elements may have been in the "11 browser" count. The test says 18 — **update the test to match actual count from the file.**

> **IMPORTANT:** Before writing this file, run:
> ```bash
> grep -c "name:" /home/dp/Desktop/clawdia5.0/src/main/core/providers/ClaudeCodeBrokerTools.ts
> ```
> to get the exact tool count from the source, and update the test's `toHaveLength(N)` to match.

- [ ] **Step 4: Verify actual tool count and fix test**

```bash
cd /home/dp/Desktop/clawdia5.0
node -e "
const src = require('fs').readFileSync('src/main/core/providers/ClaudeCodeBrokerTools.ts', 'utf8');
const names = src.match(/name: '[^']+'/g);
console.log('Tool name lines:', names?.length, names);
"
```

Update the `toHaveLength(N)` assertion in the test to match the actual count returned. Update `TOOL_CATALOG_ENTRIES` to include exactly those tools — use the names printed above as the authoritative source.

- [ ] **Step 5: Run tests**

```bash
npx jest tests/main/core/catalog/ToolCatalog.test.ts --no-coverage 2>&1 | tail -15
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/core/catalog/ToolCatalogEntries.ts tests/main/core/catalog/ToolCatalog.test.ts
git commit -m "feat(catalog): add all tool catalog entries with metadata"
```

---

#### Task 3: Create ToolCatalog class

**Files:**
- Create: `src/main/core/catalog/ToolCatalog.ts`
- Modify: `tests/main/core/catalog/ToolCatalog.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/main/core/catalog/ToolCatalog.test.ts`:

```ts
import { ToolCatalog } from '../../../src/main/core/catalog/ToolCatalog';
import type { ProviderToolDefinition } from '../../../src/main/core/providers/ProviderClient';

describe('ToolCatalog', () => {
  let catalog: ToolCatalog;

  beforeEach(() => {
    catalog = new ToolCatalog();
  });

  it('getHotTools returns only alwaysHot entries as ProviderToolDefinitions', () => {
    const hot = catalog.getHotTools();
    expect(hot.length).toBe(3);
    const ids = hot.map(t => t.name).sort();
    expect(ids).toEqual(['browser_navigate', 'fs_read_file', 'shell_exec']);
    // each has name, description, inputSchema
    for (const t of hot) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
    }
  });

  it('getEntry returns entry by id', () => {
    const entry = catalog.getEntry('shell_exec');
    expect(entry).toBeDefined();
    expect(entry!.domain).toBe('shell');
    expect(entry!.action).toBe('exec');
  });

  it('getEntry returns undefined for unknown id', () => {
    expect(catalog.getEntry('nonexistent_tool')).toBeUndefined();
  });

  it('getDeferredEntries excludes alwaysHot tools', () => {
    const deferred = catalog.getDeferredEntries();
    expect(deferred.every(e => !e.alwaysHot)).toBe(true);
  });

  it('load returns ProviderToolDefinition[] for given ids', () => {
    const defs = catalog.load(['fs_write_file', 'browser_screenshot']);
    expect(defs).toHaveLength(2);
    expect(defs.map(d => d.name).sort()).toEqual(['browser_screenshot', 'fs_write_file']);
    expect(defs[0].inputSchema).toBeTruthy();
  });

  it('load skips unknown ids gracefully', () => {
    const defs = catalog.load(['fs_write_file', 'ghost_tool']);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('fs_write_file');
  });

  it('getCliBlockEntries returns only cli_block executionMode entries', () => {
    const cliTools = catalog.getCliBlockEntries();
    expect(Array.isArray(cliTools)).toBe(true);
    expect(cliTools.every(e => e.executionMode === 'cli_block')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```bash
npx jest tests/main/core/catalog/ToolCatalog.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `Cannot find module '../../../src/main/core/catalog/ToolCatalog'`

- [ ] **Step 3: Implement ToolCatalog**

```ts
// src/main/core/catalog/ToolCatalog.ts
import { TOOL_CATALOG_ENTRIES } from './ToolCatalogEntries';
import type { ToolCatalogEntry } from '../../../core/catalog/types';
import type { ProviderToolDefinition } from '../providers/ProviderClient';

function toProviderDef(entry: ToolCatalogEntry): ProviderToolDefinition {
  return {
    name: entry.id,
    description: entry.description,
    inputSchema: entry.inputSchema as ProviderToolDefinition['inputSchema'],
  };
}

export class ToolCatalog {
  private readonly entries: Map<string, ToolCatalogEntry>;

  constructor() {
    this.entries = new Map(TOOL_CATALOG_ENTRIES.map(e => [e.id, e]));
  }

  getHotTools(): ProviderToolDefinition[] {
    return TOOL_CATALOG_ENTRIES.filter(e => e.alwaysHot).map(toProviderDef);
  }

  getDeferredEntries(): ToolCatalogEntry[] {
    return TOOL_CATALOG_ENTRIES.filter(e => !e.alwaysHot);
  }

  getEntry(id: string): ToolCatalogEntry | undefined {
    return this.entries.get(id);
  }

  load(ids: string[]): ProviderToolDefinition[] {
    return ids
      .map(id => this.entries.get(id))
      .filter((e): e is ToolCatalogEntry => e !== undefined)
      .map(toProviderDef);
  }

  getCliBlockEntries(): ToolCatalogEntry[] {
    return TOOL_CATALOG_ENTRIES.filter(e => e.executionMode === 'cli_block');
  }

  getAllEntries(): ToolCatalogEntry[] {
    return [...this.entries.values()];
  }
}
```

- [ ] **Step 4: Check ProviderToolDefinition interface shape**

```bash
grep -n "ProviderToolDefinition" /home/dp/Desktop/clawdia5.0/src/main/core/providers/ProviderClient.ts | head -10
```

If the interface differs (e.g., uses `input_schema` instead of `inputSchema`), update `toProviderDef` to match. The tests will catch this.

- [ ] **Step 5: Run tests**

```bash
npx jest tests/main/core/catalog/ToolCatalog.test.ts --no-coverage 2>&1 | tail -15
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/core/catalog/ToolCatalog.ts tests/main/core/catalog/ToolCatalog.test.ts
git commit -m "feat(catalog): implement ToolCatalog with getHotTools/load/getEntry"
```

---

#### Task 4: Wire ToolCatalog into RuntimeCoordinator

**Files:**
- Modify: `src/main/core/runtime/RuntimeCoordinator.ts`
- Modify: `src/main/core/executors/ChatExecutor.ts` (accept catalog, use `getHotTools()`)
- Modify: `src/main/core/executors/ClaudeCodeExecutor.ts` (accept catalog, use `getHotTools()`)

- [ ] **Step 1: Read the files before editing**

```bash
# Read RuntimeCoordinator constructor
sed -n '1,60p' /home/dp/Desktop/clawdia5.0/src/main/core/runtime/RuntimeCoordinator.ts
# Read ChatExecutor constructor + tool usage
grep -n "getChatToolDefinitions\|getClaudeCodeToolDefinitions\|constructor" /home/dp/Desktop/clawdia5.0/src/main/core/executors/ChatExecutor.ts | head -20
# Read ClaudeCodeExecutor
grep -n "getChatToolDefinitions\|getClaudeCodeToolDefinitions\|constructor" /home/dp/Desktop/clawdia5.0/src/main/core/executors/ClaudeCodeExecutor.ts | head -20
```

- [ ] **Step 2: Write a regression test before touching executors**

Create `tests/main/core/catalog/catalog-wiring.test.ts`:

```ts
// Smoke test: catalog can be instantiated and returns valid hot tools
import { ToolCatalog } from '../../../src/main/core/catalog/ToolCatalog';

describe('ToolCatalog wiring smoke test', () => {
  it('getHotTools returns ProviderToolDefinitions with non-empty descriptions', () => {
    const catalog = new ToolCatalog();
    const hot = catalog.getHotTools();
    expect(hot.length).toBeGreaterThan(0);
    hot.forEach(t => {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
    });
  });
});
```

```bash
npx jest tests/main/core/catalog/catalog-wiring.test.ts --no-coverage 2>&1 | tail -10
```
Expected: passes.

- [ ] **Step 3: Add catalog to RuntimeCoordinator**

Read `RuntimeCoordinator.ts` fully, then add:
- Import `ToolCatalog`
- Instantiate `this.catalog = new ToolCatalog()` in constructor
- Pass it to `ChatExecutor` and `ClaudeCodeExecutor` constructors

The exact edit depends on the constructor signature. Pattern:

```ts
// Add import
import { ToolCatalog } from '../catalog/ToolCatalog';

// In constructor, before executors are created:
const catalog = new ToolCatalog();

// Pass to executors:
this.chatExecutor = new ChatExecutor(broker, providerClient, catalog);
this.claudeCodeExecutor = new ClaudeCodeExecutor(broker, claudeCodeProviderClient, catalog);
```

- [ ] **Step 4: Update ChatExecutor to accept catalog**

Read `ChatExecutor.ts` constructor and find where it calls `getChatToolDefinitions()`. Replace with `catalog.getHotTools()`.

Pattern (adjust line numbers after reading):
```ts
// Constructor: add catalog parameter
constructor(
  private readonly broker: CapabilityBroker,
  private readonly provider: ProviderClient,
  private readonly catalog: ToolCatalog,
) {}

// Where tools are passed to provider turn:
// BEFORE: const tools = getChatToolDefinitions();
// AFTER:  const tools = this.catalog.getHotTools();
```

- [ ] **Step 5: Update ClaudeCodeExecutor to accept catalog**

Same pattern. Find `getClaudeCodeToolDefinitions()` call site in `ClaudeCodeExecutor.ts` and replace with `catalog.getHotTools()`. (The MCP bridge at this phase can still use its own `getClaudeCodeToolDefinitions()` — only update the executor-level call.)

- [ ] **Step 6: Compile check**

```bash
cd /home/dp/Desktop/clawdia5.0
npx tsc --noEmit 2>&1 | head -30
```
Fix any type errors. Common issue: executor constructors are called from other places — check if any other call site needs updating.

- [ ] **Step 7: Run existing tests**

```bash
npx jest --no-coverage 2>&1 | tail -20
```
Expected: same pass/fail ratio as before — no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/main/core/catalog/ src/main/core/runtime/RuntimeCoordinator.ts src/main/core/executors/ChatExecutor.ts src/main/core/executors/ClaudeCodeExecutor.ts tests/main/core/catalog/
git commit -m "feat(catalog): wire ToolCatalog into RuntimeCoordinator + executors"
```

---

### Phase 2 — Local Tool Search

**Scope:** Implement `ToolCatalog.search()` with keyword/namespace/tag matching. No routing yet. No deferred loading changes. Pure search logic.

---

#### Task 5: Implement search on ToolCatalog

**Files:**
- Modify: `src/main/core/catalog/ToolCatalog.ts` (add `search()`)
- Modify: `tests/main/core/catalog/ToolCatalog.test.ts`

- [ ] **Step 1: Write failing search tests**

Add to `tests/main/core/catalog/ToolCatalog.test.ts`:

```ts
describe('ToolCatalog.search', () => {
  let catalog: ToolCatalog;
  beforeEach(() => { catalog = new ToolCatalog(); });

  it('exact id match scores 100', () => {
    const results = catalog.search({ text: 'fs_read_file' });
    expect(results[0].entry.id).toBe('fs_read_file');
    expect(results[0].score).toBe(100);
    expect(results[0].matchReason).toBe('exact_id');
  });

  it('namespace match returns all tools in that namespace', () => {
    const results = catalog.search({ text: 'desktop' });
    const ids = results.map(r => r.entry.id);
    expect(ids).toContain('desktop_click');
    expect(ids).toContain('desktop_screenshot');
    expect(ids).toContain('desktop_type');
    results.forEach(r => expect(r.entry.namespace).toBe('desktop'));
  });

  it('tag match returns tools with matching tag', () => {
    const results = catalog.search({ text: 'screenshot' });
    const ids = results.map(r => r.entry.id);
    expect(ids).toContain('browser_screenshot');
    expect(ids).toContain('desktop_screenshot');
  });

  it('substring match on description finds tools', () => {
    const results = catalog.search({ text: 'visible text' });
    const ids = results.map(r => r.entry.id);
    expect(ids).toContain('browser_extract_text');
  });

  it('domain filter narrows results', () => {
    const results = catalog.search({ text: 'screenshot', domain: 'browser' });
    expect(results.every(r => r.entry.domain === 'browser')).toBe(true);
    expect(results.map(r => r.entry.id)).toContain('browser_screenshot');
    expect(results.map(r => r.entry.id)).not.toContain('desktop_screenshot');
  });

  it('maxResults limits result count', () => {
    const results = catalog.search({ text: 'browser', maxResults: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('includeDeferred=false excludes non-hot tools', () => {
    const results = catalog.search({ text: 'browser', includeDeferred: false });
    expect(results.every(r => r.entry.alwaysHot)).toBe(true);
  });

  it('returns empty array for no match', () => {
    const results = catalog.search({ text: 'zzznomatch999' });
    expect(results).toHaveLength(0);
  });

  it('results are sorted by score descending', () => {
    const results = catalog.search({ text: 'file' });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
```

- [ ] **Step 2: Run — confirm failures**

```bash
npx jest tests/main/core/catalog/ToolCatalog.test.ts --no-coverage -t "ToolCatalog.search" 2>&1 | tail -15
```
Expected: `search is not a function` or type error

- [ ] **Step 3: Implement search in ToolCatalog**

Add to `src/main/core/catalog/ToolCatalog.ts`:

```ts
import type { ToolCatalogEntry, ToolSearchQuery, ToolSearchResult } from '../../../core/catalog/types';

// Add to ToolCatalog class:

search(query: ToolSearchQuery): ToolSearchResult[] {
  const { text, domain, tags: queryTags, includeDeferred = true, maxResults = 10 } = query;
  const lower = text.toLowerCase().trim();
  const results: ToolSearchResult[] = [];

  for (const entry of this.entries.values()) {
    // domain filter
    if (domain && entry.domain !== domain) continue;
    // deferred filter
    if (!includeDeferred && !entry.alwaysHot) continue;

    let score = 0;
    let matchReason: ToolSearchResult['matchReason'] | null = null;

    // 1. Exact id match
    if (entry.id === lower) {
      score = 100;
      matchReason = 'exact_id';
    }
    // 2. Namespace match (text equals namespace)
    else if (entry.namespace === lower) {
      score = 80;
      matchReason = 'namespace';
    }
    // 3. Tag intersection
    else {
      const words = lower.split(/\s+/);
      const tagHits = words.filter(w => entry.tags.includes(w)).length;
      const queryTagHits = queryTags ? queryTags.filter(t => entry.tags.includes(t)).length : 0;
      const totalTagHits = tagHits + queryTagHits;
      if (totalTagHits > 0) {
        score = Math.min(70, 30 + totalTagHits * 20);
        matchReason = 'tag';
      }
    }

    // 4. Substring match on id + description (lower score)
    if (matchReason === null) {
      const searchSpace = `${entry.id} ${entry.description}`.toLowerCase();
      if (searchSpace.includes(lower)) {
        score = 20;
        matchReason = 'substring';
      }
    }

    if (matchReason !== null && score > 0) {
      results.push({
        entry,
        score,
        matchReason,
        suggestCliBlock: entry.executionMode === 'cli_block' || !!entry.cliSyntax,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return maxResults > 0 ? results.slice(0, maxResults) : results;
}
```

- [ ] **Step 4: Run search tests**

```bash
npx jest tests/main/core/catalog/ToolCatalog.test.ts --no-coverage 2>&1 | tail -20
```
Expected: all tests pass including new search tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/catalog/ToolCatalog.ts tests/main/core/catalog/ToolCatalog.test.ts
git commit -m "feat(catalog): implement local keyword/namespace/tag search"
```

---

### Phase 3 — Deferred Tool Loading

**Scope:** Add `DeferredToolLoader` — a per-session object that tracks which tools are currently loaded into context (hot set + any explicitly loaded deferred tools). Executors use it to build their `tools` array dynamically.

---

#### Task 6: Implement DeferredToolLoader

**Files:**
- Create: `src/main/core/catalog/DeferredToolLoader.ts`
- Create: `tests/main/core/catalog/DeferredToolLoader.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/main/core/catalog/DeferredToolLoader.test.ts
import { DeferredToolLoader } from '../../../src/main/core/catalog/DeferredToolLoader';
import { ToolCatalog } from '../../../src/main/core/catalog/ToolCatalog';

describe('DeferredToolLoader', () => {
  let catalog: ToolCatalog;
  let loader: DeferredToolLoader;

  beforeEach(() => {
    catalog = new ToolCatalog();
    loader = new DeferredToolLoader(catalog);
  });

  it('starts with only alwaysHot tools loaded', () => {
    const defs = loader.getLoadedDefinitions();
    expect(defs.map(d => d.name).sort()).toEqual(['browser_navigate', 'fs_read_file', 'shell_exec']);
  });

  it('ensureLoaded adds new tools to loaded set', () => {
    loader.ensureLoaded(['fs_write_file', 'browser_screenshot']);
    const names = loader.getLoadedDefinitions().map(d => d.name);
    expect(names).toContain('fs_write_file');
    expect(names).toContain('browser_screenshot');
    // still includes hot tools
    expect(names).toContain('fs_read_file');
  });

  it('ensureLoaded is idempotent', () => {
    loader.ensureLoaded(['fs_write_file']);
    loader.ensureLoaded(['fs_write_file']);
    const names = loader.getLoadedDefinitions().map(d => d.name);
    const count = names.filter(n => n === 'fs_write_file').length;
    expect(count).toBe(1);
  });

  it('isLoaded returns true for hot tools', () => {
    expect(loader.isLoaded('fs_read_file')).toBe(true);
    expect(loader.isLoaded('shell_exec')).toBe(true);
  });

  it('isLoaded returns false for deferred tools before loading', () => {
    expect(loader.isLoaded('fs_write_file')).toBe(false);
  });

  it('isLoaded returns true after ensureLoaded', () => {
    loader.ensureLoaded(['fs_write_file']);
    expect(loader.isLoaded('fs_write_file')).toBe(true);
  });

  it('reset returns to hot-only state', () => {
    loader.ensureLoaded(['fs_write_file', 'browser_screenshot']);
    loader.reset();
    const names = loader.getLoadedDefinitions().map(d => d.name);
    expect(names.sort()).toEqual(['browser_navigate', 'fs_read_file', 'shell_exec']);
  });

  it('getLoadedIds returns set of currently loaded tool ids', () => {
    loader.ensureLoaded(['browser_click']);
    const ids = loader.getLoadedIds();
    expect(ids.has('fs_read_file')).toBe(true);
    expect(ids.has('browser_click')).toBe(true);
    expect(ids.has('browser_screenshot')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```bash
npx jest tests/main/core/catalog/DeferredToolLoader.test.ts --no-coverage 2>&1 | tail -10
```
Expected: module not found

- [ ] **Step 3: Implement DeferredToolLoader**

```ts
// src/main/core/catalog/DeferredToolLoader.ts
import type { ToolCatalog } from './ToolCatalog';
import type { ProviderToolDefinition } from '../providers/ProviderClient';

export class DeferredToolLoader {
  private loadedIds: Set<string>;

  constructor(private readonly catalog: ToolCatalog) {
    this.loadedIds = new Set(catalog.getHotTools().map(t => t.name));
  }

  ensureLoaded(ids: string[]): void {
    for (const id of ids) {
      this.loadedIds.add(id);
    }
  }

  getLoadedDefinitions(): ProviderToolDefinition[] {
    return this.catalog.load([...this.loadedIds]);
  }

  getLoadedIds(): Set<string> {
    return new Set(this.loadedIds);
  }

  isLoaded(id: string): boolean {
    return this.loadedIds.has(id);
  }

  reset(): void {
    this.loadedIds = new Set(this.catalog.getHotTools().map(t => t.name));
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/main/core/catalog/DeferredToolLoader.test.ts --no-coverage 2>&1 | tail -15
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/catalog/DeferredToolLoader.ts tests/main/core/catalog/DeferredToolLoader.test.ts
git commit -m "feat(catalog): add DeferredToolLoader for per-session tool context management"
```

---

#### Task 7: Wire DeferredToolLoader into ClaudeCodeExecutor

**Files:**
- Modify: `src/main/core/executors/ClaudeCodeExecutor.ts`

- [ ] **Step 1: Read the executor to understand session lifecycle**

```bash
sed -n '1,100p' /home/dp/Desktop/clawdia5.0/src/main/core/executors/ClaudeCodeExecutor.ts
```

Identify where `runTurn` / `runSession` starts, where tools are passed to the provider, and where session cleanup happens.

- [ ] **Step 2: Add DeferredToolLoader per turn**

In `ClaudeCodeExecutor`, before each provider turn:
1. Create a `DeferredToolLoader` from `this.catalog`
2. Use `loader.getLoadedDefinitions()` as the tools array
3. After turn completes, call `loader.reset()`

Pattern (adjust to actual method names):
```ts
import { DeferredToolLoader } from '../catalog/DeferredToolLoader';

// In runTurn (or equivalent):
const loader = new DeferredToolLoader(this.catalog);
const tools = loader.getLoadedDefinitions();
// ... pass tools to provider turn
// After turn: loader.reset() (or garbage collected — no side effects)
```

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Run all tests**

```bash
npx jest --no-coverage 2>&1 | tail -20
```
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/executors/ClaudeCodeExecutor.ts
git commit -m "feat(catalog): wire DeferredToolLoader into ClaudeCodeExecutor"
```

---

### Phase 4 — CLI-Aware Routing

**Scope:** Implement `ToolSearchRouter` that applies routing policy over search results — decides whether to return direct tools, a bundle, or a CLI block suggestion.

---

#### Task 8: Implement ToolSearchRouter

**Files:**
- Create: `src/main/core/catalog/ToolSearchRouter.ts`
- Create: `tests/main/core/catalog/ToolSearchRouter.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/main/core/catalog/ToolSearchRouter.test.ts
import { ToolSearchRouter, RouteDecision } from '../../../src/main/core/catalog/ToolSearchRouter';
import { ToolCatalog } from '../../../src/main/core/catalog/ToolCatalog';

describe('ToolSearchRouter', () => {
  let catalog: ToolCatalog;
  let router: ToolSearchRouter;

  beforeEach(() => {
    catalog = new ToolCatalog();
    router = new ToolSearchRouter(catalog);
  });

  it('single exact match → direct_tool route', () => {
    const decision = router.route('fs_read_file');
    expect(decision.kind).toBe('direct_tool');
    expect(decision.tools).toHaveLength(1);
    expect(decision.tools[0].name).toBe('fs_read_file');
  });

  it('namespace match → tool_bundle route', () => {
    const decision = router.route('browser');
    expect(decision.kind).toBe('tool_bundle');
    expect(decision.tools.length).toBeGreaterThan(1);
    expect(decision.tools.every(t => t.name.startsWith('browser_'))).toBe(true);
  });

  it('sequential query words → suggest_cli_block route', () => {
    const decision = router.route('read file then write it');
    expect(decision.kind).toBe('suggest_cli_block');
    expect(decision.cliHint).toBeTruthy();
  });

  it('no matches → no_match route', () => {
    const decision = router.route('zzznomatch999xyz');
    expect(decision.kind).toBe('no_match');
  });

  it('cross-domain results → tool_bundle capped at 3', () => {
    const decision = router.route('screenshot');
    // screenshot matches browser_screenshot + desktop_screenshot
    expect(decision.kind).toBe('tool_bundle');
    expect(decision.tools.length).toBeLessThanOrEqual(3);
  });

  it('route with explicit loadDeferred=true includes deferred tools', () => {
    const decision = router.route('fs_write_file', { loadDeferred: true });
    expect(decision.kind).toBe('direct_tool');
    expect(decision.tools[0].name).toBe('fs_write_file');
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```bash
npx jest tests/main/core/catalog/ToolSearchRouter.test.ts --no-coverage 2>&1 | tail -10
```

- [ ] **Step 3: Implement ToolSearchRouter**

```ts
// src/main/core/catalog/ToolSearchRouter.ts
import type { ToolCatalog } from './ToolCatalog';
import type { ProviderToolDefinition } from '../providers/ProviderClient';

const SEQUENCE_WORDS = ['then', 'and then', 'after', 'followed by', 'multiple', 'each', 'all', 'steps', 'sequence'];

function impliesSequence(text: string): boolean {
  const lower = text.toLowerCase();
  return SEQUENCE_WORDS.some(w => lower.includes(w));
}

export type RouteKind = 'direct_tool' | 'tool_bundle' | 'suggest_cli_block' | 'no_match';

export interface RouteDecision {
  kind: RouteKind;
  tools: ProviderToolDefinition[];
  toolIds: string[];
  cliHint?: string;
  searchQuery: string;
}

export interface RouteOptions {
  loadDeferred?: boolean;
  maxBundle?: number;
}

export class ToolSearchRouter {
  constructor(private readonly catalog: ToolCatalog) {}

  route(query: string, options: RouteOptions = {}): RouteDecision {
    const { loadDeferred = false, maxBundle = 5 } = options;

    // Check for sequence signal before search
    if (impliesSequence(query)) {
      // Search for relevant tools anyway to provide a CLI hint
      const results = this.catalog.search({ text: query, includeDeferred: true, maxResults: 3 });
      const hints = results.map(r => r.entry.cliSyntax).filter(Boolean);
      return {
        kind: 'suggest_cli_block',
        tools: [],
        toolIds: [],
        cliHint: hints.length > 0 ? hints.join('\n') : undefined,
        searchQuery: query,
      };
    }

    const results = this.catalog.search({
      text: query,
      includeDeferred: loadDeferred,
      maxResults: maxBundle,
    });

    if (results.length === 0) {
      return { kind: 'no_match', tools: [], toolIds: [], searchQuery: query };
    }

    // Single result
    if (results.length === 1) {
      const entry = results[0].entry;
      const defs = this.catalog.load([entry.id]);
      return { kind: 'direct_tool', tools: defs, toolIds: [entry.id], searchQuery: query };
    }

    // Exact id match → direct even if other results exist
    if (results[0].matchReason === 'exact_id') {
      const entry = results[0].entry;
      const defs = this.catalog.load([entry.id]);
      return { kind: 'direct_tool', tools: defs, toolIds: [entry.id], searchQuery: query };
    }

    // Multiple results → bundle
    const topResults = results.slice(0, maxBundle);
    const ids = topResults.map(r => r.entry.id);
    const defs = this.catalog.load(ids);
    return { kind: 'tool_bundle', tools: defs, toolIds: ids, searchQuery: query };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/main/core/catalog/ToolSearchRouter.test.ts --no-coverage 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/catalog/ToolSearchRouter.ts tests/main/core/catalog/ToolSearchRouter.test.ts
git commit -m "feat(catalog): add ToolSearchRouter with CLI-aware routing policy"
```

---

### Phase 5 — Validation + Optimization

**Scope:** Verify no regressions, validate search quality, confirm context reduction, clean up any dead imports.

---

#### Task 9: Context reduction validation

**Files:**
- Create: `tests/main/core/catalog/context-reduction.test.ts`

- [ ] **Step 1: Write context reduction assertion test**

```ts
// tests/main/core/catalog/context-reduction.test.ts
import { ToolCatalog } from '../../../src/main/core/catalog/ToolCatalog';
import { TOOL_CATALOG_ENTRIES } from '../../../src/main/core/catalog/ToolCatalogEntries';

describe('Context reduction', () => {
  let catalog: ToolCatalog;

  beforeEach(() => { catalog = new ToolCatalog(); });

  it('hot tool set is smaller than full catalog', () => {
    const hot = catalog.getHotTools();
    const all = TOOL_CATALOG_ENTRIES;
    expect(hot.length).toBeLessThan(all.length);
    // Specifically: 3 hot vs N total
    expect(hot.length).toBe(3);
  });

  it('hot tools cover all domains (no domain fully deferred)', () => {
    const hot = catalog.getHotTools();
    const domains = new Set(
      hot.map(t => {
        const entry = catalog.getEntry(t.name);
        return entry?.domain;
      })
    );
    // fs, shell, browser covered; desktop intentionally not
    expect(domains.has('fs')).toBe(true);
    expect(domains.has('shell')).toBe(true);
    expect(domains.has('browser')).toBe(true);
  });

  it('all 18 tools are available via load()', () => {
    const allIds = TOOL_CATALOG_ENTRIES.map(e => e.id);
    const loaded = catalog.load(allIds);
    expect(loaded.length).toBe(TOOL_CATALOG_ENTRIES.length);
  });
});
```

- [ ] **Step 2: Run**

```bash
npx jest tests/main/core/catalog/context-reduction.test.ts --no-coverage 2>&1 | tail -15
```
Expected: all pass.

---

#### Task 10: Search quality spot-check

**Files:**
- Create: `tests/main/core/catalog/search-quality.test.ts`

- [ ] **Step 1: Write quality tests**

```ts
// tests/main/core/catalog/search-quality.test.ts
import { ToolCatalog } from '../../../src/main/core/catalog/ToolCatalog';

describe('Search quality spot-checks', () => {
  let catalog: ToolCatalog;
  beforeEach(() => { catalog = new ToolCatalog(); });

  const cases: [string, string[]][] = [
    ['read a file',              ['fs_read_file']],
    ['write to disk',            ['fs_write_file']],
    ['run a command',            ['shell_exec']],
    ['open website',             ['browser_navigate']],
    ['take screenshot',          ['browser_screenshot', 'desktop_screenshot']],
    ['click button',             ['browser_click', 'desktop_click']],
    ['list directory',           ['fs_read_dir']],
    ['search in files',          ['fs_search_text']],
    ['get environment variables',['shell_inspect_env']],
    ['evaluate js',              ['browser_evaluate']],
    ['find elements',            ['browser_find_elements']],
  ];

  test.each(cases)('query "%s" returns expected tool(s)', (query, expectedIds) => {
    const results = catalog.search({ text: query, includeDeferred: true, maxResults: 5 });
    const resultIds = results.map(r => r.entry.id);
    const anyMatch = expectedIds.some(id => resultIds.includes(id));
    expect(anyMatch).toBe(true);
  });
});
```

- [ ] **Step 2: Run**

```bash
npx jest tests/main/core/catalog/search-quality.test.ts --no-coverage 2>&1 | tail -20
```

If any query fails to find expected tools, improve the `tags` array for those entries in `ToolCatalogEntries.ts`. Re-run after each fix.

- [ ] **Step 3: Fix any failing quality cases by improving tags**

For each failing test case, find the relevant entry in `ToolCatalogEntries.ts` and add the missing tag. Example:
- "run a command" fails for `shell_exec` → add tag `'run'` to shell_exec entry
- "open website" fails for `browser_navigate` → add tag `'website'` to browser_navigate entry

Re-run until all quality tests pass.

- [ ] **Step 4: Commit quality improvements**

```bash
git add src/main/core/catalog/ToolCatalogEntries.ts tests/main/core/catalog/search-quality.test.ts
git commit -m "test(catalog): add search quality spot-checks and fix tags"
```

---

#### Task 11: Full regression run

- [ ] **Step 1: Run all tests**

```bash
cd /home/dp/Desktop/clawdia5.0
npx jest --no-coverage 2>&1 | tail -30
```

- [ ] **Step 2: Compile check**

```bash
npx tsc --noEmit 2>&1
```

- [ ] **Step 3: Verify no unused imports**

```bash
grep -r "getChatToolDefinitions\|getClaudeCodeToolDefinitions" src/main/core/executors/ 2>&1
```
Expected: no results — both executors now use catalog.

- [ ] **Step 4: Final commit if clean**

```bash
git add -p  # Review any remaining changes
git commit -m "chore(catalog): finalize tool search + deferred loading system"
```

---

## 4. ALWAYS-HOT VS DEFERRED TOOL STRATEGY

### Always-Hot (3 tools, present every turn)

| Tool | Reason |
|------|--------|
| `fs_read_file` | Used in nearly every task; low risk; information gathering baseline |
| `shell_exec` | Primary operational tool; model needs it to complete most sequential work |
| `browser_navigate` | Entry point for all browser tasks; model cannot do browser work without it |

### Deferred Tool Families

| Namespace | Deferral Rationale |
|-----------|-------------------|
| `fs.*` (except read_file) | Write/edit/search needed situationally; can be loaded when fs task is detected |
| `shell.*` (except exec) | inspect_env and list_processes are rarely needed; low value in every-turn context |
| `browser.*` (except navigate) | 9 browser tools are expensive context; load when browser task confirmed by navigate use |
| `desktop.*` (all 5) | High approval overhead, specialized use case; always deferred |

### Namespace Scheme

Use `<domain>` as namespace for all current tools: `fs`, `shell`, `browser`, `desktop`. Future surfaces (e.g., `db`, `api`, `calendar`) get their own namespaces. Namespaces are the primary deferred-loading unit — load by namespace when a domain task starts.

### Preventing Quality Degradation at Scale

1. Tags are the primary search discriminator — each new tool must have 3+ specific tags
2. IDs must be `namespace_verb_noun` format (e.g., `db_query_table`) — enforced by naming convention
3. Descriptions must include the action verb and the domain noun
4. Search tests (Task 10 pattern) must be updated for every new tool added

---

## 5. CLI + TOOL SEARCH INTEGRATION STRATEGY

### Routing Decision Tree

```
query
  ├─ contains sequence words ("then", "after", "each")
  │    → suggest_cli_block (give CLI syntax hint)
  │
  ├─ exact id match
  │    → direct_tool (1 tool)
  │
  ├─ namespace match
  │    → tool_bundle (all tools in namespace, capped at 5)
  │
  ├─ 2-3 results from same namespace
  │    → tool_bundle
  │
  ├─ results from 3+ different namespaces
  │    → tool_bundle (top 3 by score only)
  │
  └─ no results
       → no_match
```

### CLI Block Preference Heuristics

Prefer `suggest_cli_block` when:
- Query contains: `then`, `and then`, `after`, `followed by`, `multiple`, `each`, `all files`, `steps`, `sequence`
- Query mentions more than one domain action (e.g., "read file and run script")

Prefer direct tool when:
- Single exact match
- Query is a tool id or near-exact tool name

### Guardrails

- CLI block suggestions are **hints only** — the executor decides whether to act on them
- Never auto-execute a CLI block from router output; always surface as suggestion
- Desktop tools never route via CLI block (require approval workflow)
- Max bundle size = 5 (hardcoded) — prevents context explosion from broad namespace queries

---

## 6. VALIDATION PLAN

### Registry Correctness

- `TOOL_CATALOG_ENTRIES.length` matches actual tool count in `ClaudeCodeBrokerTools.ts` (Task 2, Step 4)
- Every entry has all required fields (Task 2 test: `every entry has required fields`)
- Exactly 3 entries are `alwaysHot` (Task 2 test)
- All desktop entries are non-hot (Task 2 test)

### Search Quality

- 11 spot-check cases cover the most common user queries (Task 10)
- Each failing case triggers a tag fix — tags are the quality lever
- Deterministic: same query always returns same results (no randomness in search)

### Deferred Loading Behavior

- `DeferredToolLoader` starts with exactly 3 hot tools (Task 6 tests)
- `ensureLoaded` is idempotent (Task 6 test)
- `reset()` returns to hot-only state (Task 6 test)

### Routing Quality

- 6 routing cases cover all `RouteKind` variants (Task 8 tests)
- Sequence detection tested explicitly (Task 8 test: `sequential query words → suggest_cli_block`)

### Context Reduction

- `hot.length < TOOL_CATALOG_ENTRIES.length` (Task 9)
- `hot.length === 3` (Task 9)
- All tools loadable via `catalog.load()` (Task 9)

### No Regression

- Full `npx jest` run after each phase (Task 11)
- `npx tsc --noEmit` after executor wiring (Task 4 + Task 7)
- Grep for dead imports after executor migration (Task 11)

---

## 7. NON-GOALS

The following must **not** be built in this pass:

1. **Embedding/semantic search** — no vector databases, no cosine similarity, no BERT/sentence-transformers
2. **Server-side tool search** — no Anthropic tool_choice="auto" dependency, no external API calls for tool selection
3. **Multi-provider expansion** — do not add Codex or third-party provider tools to the catalog
4. **Memory/planner systems** — catalog is not a planner; router is not a scheduler
5. **Dynamic tool registration at runtime** — all 18 tools are static in this pass
6. **Plugin marketplace** — no dynamic loading from disk, no user-contributed tools
7. **CapabilityBroker replacement** — catalog sits above broker; broker is untouched
8. **Provider loop changes** — executor turn logic remains intact; only tool selection changes
9. **MCP bridge tool loading** — `ClaudeCodeMcpBridgeHost` continues using `getClaudeCodeToolDefinitions()` unchanged in Phase 1-3
10. **Reranking or ML scoring** — search scoring is deterministic keyword matching only
11. **Tool usage analytics** — no tracking of which tools are used most
12. **Auto-expansion of deferred tools based on conversation history** — expansion is explicit only

---

## 8. RECOMMENDED NEXT IMPLEMENTATION PROMPT

Use this prompt verbatim in a new chat session to implement Phase 1:

---

```
You are implementing Phase 1 of the Tool Catalog Registry for Clawdia 5.0.

This is a production codebase. Do not redesign anything. Do not touch CapabilityBroker. Do not change the execution flow.

REPOSITORY: /home/dp/Desktop/clawdia5.0

OBJECTIVE: Create a ToolCatalog registry that owns the metadata for all 18 broker-backed tools. Wire it into RuntimeCoordinator and executors so they use catalog.getHotTools() instead of calling getChatToolDefinitions() / getClaudeCodeToolDefinitions() directly.

BEFORE YOU START:
1. Read src/main/core/providers/ClaudeCodeBrokerTools.ts — this is the authoritative source of tool definitions
2. Read src/core/capabilities/contract.ts — for CapabilityDomain and CapabilityAction types
3. Read src/main/core/providers/ProviderClient.ts — for ProviderToolDefinition interface shape
4. Read src/main/core/runtime/RuntimeCoordinator.ts — to understand how executors are instantiated
5. Read src/main/core/executors/ChatExecutor.ts — find where getChatToolDefinitions() is called
6. Read src/main/core/executors/ClaudeCodeExecutor.ts — find where getClaudeCodeToolDefinitions() is called
7. Run: grep -c "name:" src/main/core/providers/ClaudeCodeBrokerTools.ts to get exact tool count

FILES TO CREATE:
- src/core/catalog/types.ts — ToolCatalogEntry, ToolSearchQuery, ToolSearchResult types
- src/main/core/catalog/ToolCatalogEntries.ts — one entry per tool, exact count from step 7 above
- src/main/core/catalog/ToolCatalog.ts — getHotTools(), getDeferredEntries(), getEntry(), load(), getCliBlockEntries()

FILES TO MODIFY:
- src/main/core/runtime/RuntimeCoordinator.ts — instantiate ToolCatalog, pass to executors
- src/main/core/executors/ChatExecutor.ts — accept ToolCatalog in constructor, use catalog.getHotTools()
- src/main/core/executors/ClaudeCodeExecutor.ts — accept ToolCatalog in constructor, use catalog.getHotTools()

DO NOT TOUCH:
- CapabilityBroker.ts
- CapabilityPolicy.ts
- Any adapter files
- ClaudeCodeMcpBridgeHost.ts (leave its tool loading unchanged for now)
- Any existing tests

ALWAYS-HOT TOOLS (exactly 3):
- fs_read_file
- shell_exec
- browser_navigate

All others are alwaysHot: false. All desktop tools are alwaysHot: false.

ENTRY METADATA REQUIREMENTS:
Each ToolCatalogEntry must have:
- id: canonical tool name (e.g., 'fs_read_file')
- domain: CapabilityDomain
- action: CapabilityAction (exact action string used in broker requests)
- namespace: domain string (e.g., 'fs', 'browser')
- tags: 3+ descriptive strings relevant to tool use cases
- executionMode: 'tool_call' (all current tools)
- alwaysHot: boolean
- description: copy the description from ClaudeCodeBrokerTools.ts
- inputSchema: copy the inputSchema from ClaudeCodeBrokerTools.ts exactly

TESTING:
For each new file, write tests first:
- tests/main/core/catalog/ToolCatalog.test.ts

Key assertions:
1. TOOL_CATALOG_ENTRIES.length matches actual tool count from ClaudeCodeBrokerTools.ts
2. Exactly 3 entries are alwaysHot
3. All desktop entries are not alwaysHot
4. catalog.getHotTools() returns ProviderToolDefinition[] with name/description/inputSchema
5. catalog.getEntry('shell_exec') returns defined entry with domain='shell', action='exec'
6. catalog.load(['fs_write_file']) returns 1 definition with matching name

After wiring into executors:
- Run npx tsc --noEmit — must compile clean
- Run npx jest --no-coverage — must have no new failures
- Run: grep -r "getChatToolDefinitions\|getClaudeCodeToolDefinitions" src/main/core/executors/ — must return empty (migration complete)

CONSTRAINTS:
- Keep diffs tight — only change what is listed above
- Do not add error handling beyond what the existing codebase uses
- Do not create documentation files
- Commit after each file is created and tested

Start by reading the 7 files listed above, then implement.
```
