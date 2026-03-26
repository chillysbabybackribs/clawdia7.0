# Browser CLI Tool Dispatch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Clawdia's existing `BrowserService` into the Anthropic chat loop as native tool use so the LLM can navigate and interact with the browser during conversations.

**Architecture:** Define Anthropic tool schemas for all browser operations in a new `browserTools.ts` file. Extend `streamAnthropicChat` to accept an optional `BrowserService` and run an agentic tool-use loop — detect `tool_use` blocks, execute against `BrowserService`, append `tool_result`, re-request until Claude returns a final text response. Pass `browserService` from `registerIpc` into the chat stream call.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (tool use API), Electron `BrowserView`, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/core/cli/browserTools.ts` | **Create** | Anthropic tool schema definitions + executor that maps tool names to `BrowserService` methods |
| `src/main/anthropicChat.ts` | **Modify** | Add `browserService?` to `StreamParams`, add agentic tool-use loop |
| `src/main/registerIpc.ts` | **Modify** | Pass `browserService` into `streamAnthropicChat` on `CHAT_SEND` |
| `tests/main/core/cli/browserTools.test.ts` | **Create** | Unit tests for the tool executor |
| `tests/main/anthropicChat.tool-loop.test.ts` | **Create** | Integration test for the agentic loop in `streamAnthropicChat` |

---

## Task 1: Create `browserTools.ts` — tool schemas

**Files:**
- Create: `src/main/core/cli/browserTools.ts`

- [ ] **Step 1: Create the file with Anthropic tool schema definitions**

```typescript
// src/main/core/cli/browserTools.ts
import type Anthropic from '@anthropic-ai/sdk';
import type { BrowserService } from '../browser/BrowserService';

export const BROWSER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL. Returns the final URL and page title.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element identified by a CSS selector.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to click' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an element identified by a CSS selector. Clears the field first by default.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input element' },
        text: { type: 'string', description: 'Text to type' },
        clearFirst: { type: 'boolean', description: 'Clear the field before typing (default: true)' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll to an element by CSS selector, or scroll the window by deltaY pixels if no selector.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to scroll into view (optional)' },
        deltaY: { type: 'number', description: 'Pixels to scroll vertically (default: 500)' },
      },
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until a CSS selector appears in the DOM. Returns error on timeout.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default: 10000)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_evaluate_js',
    description: 'Evaluate a JavaScript expression in the current page context and return the serializable result.',
    input_schema: {
      type: 'object' as const,
      properties: {
        expression: { type: 'string', description: 'JavaScript expression to evaluate' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'browser_find_elements',
    description: 'Find elements matching a CSS selector. Returns array of { tag, text, attrs }.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to query' },
        limit: { type: 'number', description: 'Max elements to return (default: 20)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_get_page_state',
    description: 'Get current page URL, title, loading state, and a text excerpt (up to 1200 chars).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current browser view. Returns the file path.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'browser_extract_text',
    description: 'Extract all visible text from the current page (up to 5500 chars).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'browser_new_tab',
    description: 'Open a new browser tab, optionally navigating to a URL.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to open in the new tab (optional)' },
      },
    },
  },
  {
    name: 'browser_switch_tab',
    description: 'Switch to a browser tab by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Tab ID to switch to' },
      },
      required: ['id'],
    },
  },
  {
    name: 'browser_list_tabs',
    description: 'List all open browser tabs with their IDs, titles, URLs, and active state.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

export type BrowserToolInput = Record<string, unknown>;

export async function executeBrowserTool(
  name: string,
  input: BrowserToolInput,
  browser: BrowserService,
): Promise<unknown> {
  switch (name) {
    case 'browser_navigate': {
      const result = await browser.navigate(input.url as string);
      return { url: result.url, title: result.title };
    }
    case 'browser_click':
      return browser.click(input.selector as string);
    case 'browser_type':
      return browser.type(
        input.selector as string,
        input.text as string,
        input.clearFirst !== false,
      );
    case 'browser_scroll':
      return browser.scroll(
        (input.selector as string | undefined) ?? null,
        input.deltaY as number | undefined,
      );
    case 'browser_wait_for':
      return browser.waitFor(
        input.selector as string,
        input.timeoutMs as number | undefined,
      );
    case 'browser_evaluate_js':
      return browser.evaluateJs(input.expression as string);
    case 'browser_find_elements':
      return browser.findElements(
        input.selector as string,
        input.limit as number | undefined,
      );
    case 'browser_get_page_state':
      return browser.getPageState();
    case 'browser_screenshot': {
      const shot = await browser.screenshot();
      return { path: shot.path };
    }
    case 'browser_extract_text':
      return browser.extractText();
    case 'browser_new_tab': {
      const tab = await browser.newTab(input.url as string | undefined);
      return { id: tab.id, url: tab.url, title: tab.title };
    }
    case 'browser_switch_tab':
      await browser.switchTab(input.id as string);
      return { ok: true };
    case 'browser_list_tabs':
      return browser.listTabs();
    default:
      return { ok: false, error: `Unknown browser tool: ${name}` };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/core/cli/browserTools.ts
git commit -m "feat: add browser tool schemas and executor"
```

---

## Task 2: Test the browser tool executor

**Files:**
- Create: `tests/main/core/cli/browserTools.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// tests/main/core/cli/browserTools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { executeBrowserTool, BROWSER_TOOLS } from '../../../../src/main/core/cli/browserTools';
import type { BrowserService } from '../../../../src/main/core/browser/BrowserService';

function makeBrowser(overrides: Partial<BrowserService> = {}): BrowserService {
  return {
    navigate: vi.fn().mockResolvedValue({ tabId: 't1', url: 'https://example.com', title: 'Example' }),
    click: vi.fn().mockResolvedValue({ ok: true }),
    type: vi.fn().mockResolvedValue({ ok: true }),
    scroll: vi.fn().mockResolvedValue({ ok: true }),
    waitFor: vi.fn().mockResolvedValue({ ok: true }),
    evaluateJs: vi.fn().mockResolvedValue({ ok: true, data: 42 }),
    findElements: vi.fn().mockResolvedValue({ ok: true, data: [{ tag: 'a', text: 'Link', attrs: {} }] }),
    getPageState: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example', isLoading: false, canGoBack: false, canGoForward: false, textSample: 'Hello' }),
    screenshot: vi.fn().mockResolvedValue({ path: '/tmp/shot.png', mimeType: 'image/png', width: 1280, height: 800 }),
    extractText: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example', text: 'Page text', truncated: false }),
    newTab: vi.fn().mockResolvedValue({ id: 't2', title: 'New Tab', url: '', active: true, isLoading: false, isNewTab: true }),
    switchTab: vi.fn().mockResolvedValue(undefined),
    listTabs: vi.fn().mockResolvedValue([{ id: 't1', title: 'Example', url: 'https://example.com', active: true, isLoading: false, isNewTab: false }]),
    // Unused stubs
    setBounds: vi.fn(),
    getExecutionMode: vi.fn(),
    open: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    closeTab: vi.fn(),
    matchHistory: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    listSessions: vi.fn(),
    clearSession: vi.fn(),
    on: vi.fn(),
    getPageInfo: vi.fn(),
    ...overrides,
  } as unknown as BrowserService;
}

describe('BROWSER_TOOLS', () => {
  it('exports 13 tool definitions', () => {
    expect(BROWSER_TOOLS).toHaveLength(13);
  });

  it('every tool has a name, description, and input_schema', () => {
    for (const tool of BROWSER_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema).toBeDefined();
    }
  });
});

describe('executeBrowserTool', () => {
  it('browser_navigate calls browser.navigate and returns url+title', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_navigate', { url: 'https://example.com' }, browser);
    expect(browser.navigate).toHaveBeenCalledWith('https://example.com');
    expect(result).toEqual({ url: 'https://example.com', title: 'Example' });
  });

  it('browser_click calls browser.click with selector', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_click', { selector: '#btn' }, browser);
    expect(browser.click).toHaveBeenCalledWith('#btn');
    expect(result).toEqual({ ok: true });
  });

  it('browser_type passes clearFirst=true by default', async () => {
    const browser = makeBrowser();
    await executeBrowserTool('browser_type', { selector: 'input', text: 'hello' }, browser);
    expect(browser.type).toHaveBeenCalledWith('input', 'hello', true);
  });

  it('browser_type passes clearFirst=false when specified', async () => {
    const browser = makeBrowser();
    await executeBrowserTool('browser_type', { selector: 'input', text: 'hello', clearFirst: false }, browser);
    expect(browser.type).toHaveBeenCalledWith('input', 'hello', false);
  });

  it('browser_scroll passes null selector when omitted', async () => {
    const browser = makeBrowser();
    await executeBrowserTool('browser_scroll', { deltaY: 300 }, browser);
    expect(browser.scroll).toHaveBeenCalledWith(null, 300);
  });

  it('browser_wait_for passes timeoutMs', async () => {
    const browser = makeBrowser();
    await executeBrowserTool('browser_wait_for', { selector: '.loaded', timeoutMs: 5000 }, browser);
    expect(browser.waitFor).toHaveBeenCalledWith('.loaded', 5000);
  });

  it('browser_evaluate_js returns ok+data', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_evaluate_js', { expression: '1+1' }, browser);
    expect(result).toEqual({ ok: true, data: 42 });
  });

  it('browser_find_elements returns ok+data array', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_find_elements', { selector: 'a' }, browser);
    expect(result).toEqual({ ok: true, data: [{ tag: 'a', text: 'Link', attrs: {} }] });
  });

  it('browser_get_page_state returns full state', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_get_page_state', {}, browser) as { textSample: string };
    expect(result).toMatchObject({ url: 'https://example.com', title: 'Example', textSample: 'Hello' });
  });

  it('browser_screenshot returns path only', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_screenshot', {}, browser);
    expect(result).toEqual({ path: '/tmp/shot.png' });
  });

  it('browser_extract_text returns text content', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_extract_text', {}, browser);
    expect(result).toMatchObject({ text: 'Page text', truncated: false });
  });

  it('browser_new_tab returns id+url+title', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_new_tab', { url: 'https://example.com' }, browser);
    expect(result).toEqual({ id: 't2', url: '', title: 'New Tab' });
  });

  it('browser_switch_tab calls switchTab and returns ok', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_switch_tab', { id: 't1' }, browser);
    expect(browser.switchTab).toHaveBeenCalledWith('t1');
    expect(result).toEqual({ ok: true });
  });

  it('browser_list_tabs returns tab array', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_list_tabs', {}, browser) as unknown[];
    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ id: string }>)[0].id).toBe('t1');
  });

  it('returns error for unknown tool name', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_unknown', {}, browser);
    expect(result).toEqual({ ok: false, error: 'Unknown browser tool: browser_unknown' });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/main/core/cli/browserTools.test.ts
```

Expected: 16 tests pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add tests/main/core/cli/browserTools.test.ts
git commit -m "test: add browser tool executor unit tests"
```

---

## Task 3: Extend `streamAnthropicChat` with the agentic tool loop

**Files:**
- Modify: `src/main/anthropicChat.ts`

- [ ] **Step 1: Add `browserService` to `StreamParams` and import tool definitions**

At the top of `src/main/anthropicChat.ts`, add the import after the existing imports:

```typescript
import { BROWSER_TOOLS, executeBrowserTool } from './core/cli/browserTools';
import type { BrowserService } from './core/browser/BrowserService';
```

Then update the `StreamParams` type (replace the existing definition):

```typescript
type StreamParams = {
  webContents: WebContents;
  apiKey: string;
  modelRegistryId: string;
  userText: string;
  attachments?: MessageAttachment[];
  /** Prior turns; mutated on success with user + assistant messages */
  sessionMessages: Anthropic.MessageParam[];
  signal: AbortSignal;
  /** When provided, browser tools are enabled in the chat loop */
  browserService?: BrowserService;
};
```

- [ ] **Step 2: Add the tool-use loop after the `runStream` function**

Add this new function after `runStream` (before the `try` block at line 147):

```typescript
  /** Run one non-streaming tool-use turn and return the assistant message. */
  const runToolTurn = async (
    messages: Anthropic.MessageParam[],
  ): Promise<Anthropic.Message> => {
    const body: Anthropic.MessageCreateParams = {
      model: apiModelId,
      max_tokens: 8192,
      messages,
      tools: BROWSER_TOOLS,
    };
    return client.messages.create(body, { signal });
  };

  /** Execute tool calls from an assistant message and return tool_result blocks. */
  const executeTools = async (
    toolUseBlocks: Anthropic.ToolUseBlock[],
    browser: BrowserService,
  ): Promise<Anthropic.ToolResultBlockParam[]> => {
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const startMs = Date.now();
      let output: unknown;
      try {
        output = await executeBrowserTool(block.name, block.input as Record<string, unknown>, browser);
      } catch (err) {
        output = { ok: false, error: (err as Error).message };
      }
      const durationMs = Date.now() - startMs;
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
          id: block.id,
          name: block.name,
          status: (output as { ok?: boolean }).ok === false ? 'error' : 'success',
          detail: JSON.stringify(output).slice(0, 200),
          durationMs,
        });
      }
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(output),
      });
    }
    return results;
  };
```

- [ ] **Step 3: Replace the main try block to wire in the agentic loop**

Replace the existing `try` block (lines 147–183 in `anthropicChat.ts`) with the following. The existing streaming path runs when no `browserService` is provided; the agentic path runs when it is.

```typescript
  try {
    sessionMessages.push(userMessage);

    let assistantText = '';

    if (!browserService) {
      // ── Standard streaming path (no tools) ──────────────────────────────
      try {
        assistantText = await runStream(true);
      } catch (firstErr: unknown) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (tryThinking && (msg.includes('thinking') || msg.includes('Thinking') || msg.includes('400'))) {
          assistantText = await runStream(false);
        } else {
          throw firstErr;
        }
      }
    } else {
      // ── Agentic tool-use loop ────────────────────────────────────────────
      const loopMessages: Anthropic.MessageParam[] = [...messagesForRequest];
      const MAX_TOOL_TURNS = 20;
      let turns = 0;

      while (turns < MAX_TOOL_TURNS) {
        turns++;
        const response = await runToolTurn(loopMessages);

        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        const textBlocks = response.content.filter(
          (b): b is Anthropic.TextBlock => b.type === 'text',
        );

        // Stream any text content to the renderer
        for (const block of textBlocks) {
          if (block.text) {
            assistantText += block.text;
            if (!webContents.isDestroyed()) {
              webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, block.text);
            }
          }
        }

        // Append assistant turn to loop messages
        loopMessages.push({ role: 'assistant', content: response.content });

        // If no tool calls, we're done
        if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
          break;
        }

        // Execute tools and append results
        const toolResults = await executeTools(toolUseBlocks, browserService);
        loopMessages.push({ role: 'user', content: toolResults });
      }

      // Sync the canonical session with what happened in the loop (skip the
      // first user message we already pushed above)
      for (let i = messagesForRequest.length; i < loopMessages.length; i++) {
        sessionMessages.push(loopMessages[i]);
      }
    }

    // Push final assistant text to session history (streaming path only —
    // agentic path already pushed all turns above)
    if (!browserService) {
      sessionMessages.push({
        role: 'assistant',
        content: assistantText,
      });
    }

    if (!webContents.isDestroyed()) {
      webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });
    }

    return { response: assistantText };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === 'AbortError') {
      if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true });
      return { response: '', error: 'Stopped' };
    }
    sessionMessages.pop();
    if (!webContents.isDestroyed()) {
      webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
    }
    return { response: '', error: err.message };
  }
```

Also update the function signature to destructure `browserService`:

```typescript
export async function streamAnthropicChat({
  webContents,
  apiKey,
  modelRegistryId,
  userText,
  attachments,
  sessionMessages,
  signal,
  browserService,
}: StreamParams): Promise<{ response: string; error?: string }> {
```

- [ ] **Step 4: Commit**

```bash
git add src/main/anthropicChat.ts
git commit -m "feat: add agentic browser tool-use loop to streamAnthropicChat"
```

---

## Task 4: Pass `browserService` into `streamAnthropicChat` from `registerIpc`

**Files:**
- Modify: `src/main/registerIpc.ts`

- [ ] **Step 1: Update the `CHAT_SEND` handler to pass `browserService`**

In `registerIpc.ts`, find the `CHAT_SEND` handler's `streamAnthropicChat` call (around line 194). It currently looks like:

```typescript
    return streamAnthropicChat({
      webContents: event.sender,
      apiKey,
      modelRegistryId: model,
      userText: text,
      attachments,
      sessionMessages,
      signal: chatAbort.signal,
    });
```

Replace it with:

```typescript
    return streamAnthropicChat({
      webContents: event.sender,
      apiKey,
      modelRegistryId: model,
      userText: text,
      attachments,
      sessionMessages,
      signal: chatAbort.signal,
      browserService,
    });
```

`browserService` is already in scope as the parameter to `registerIpc(browserService: ElectronBrowserService)`.

- [ ] **Step 2: Commit**

```bash
git add src/main/registerIpc.ts
git commit -m "feat: pass browserService into streamAnthropicChat for tool-use"
```

---

## Task 5: Integration test — agentic tool loop in `streamAnthropicChat`

**Files:**
- Create: `tests/main/anthropicChat.tool-loop.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// tests/main/anthropicChat.tool-loop.test.ts
/**
 * Tests the agentic tool-use loop inside streamAnthropicChat.
 * Mocks the Anthropic SDK and BrowserService so no real network or Electron is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @anthropic-ai/sdk ──────────────────────────────────────────────────
const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
        stream: mockStream,
      },
    })),
  };
});

// ── Import after mock ───────────────────────────────────────────────────────
import { streamAnthropicChat } from '../../src/main/anthropicChat';
import type { BrowserService } from '../../src/main/core/browser/BrowserService';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeWebContents() {
  const sent: Array<[string, unknown]> = [];
  return {
    isDestroyed: () => false,
    send: vi.fn((channel: string, payload: unknown) => { sent.push([channel, payload]); }),
    _sent: sent,
  };
}

function makeBrowser(): BrowserService {
  return {
    navigate: vi.fn().mockResolvedValue({ tabId: 't1', url: 'https://example.com', title: 'Example' }),
    getPageState: vi.fn().mockResolvedValue({
      url: 'https://example.com',
      title: 'Example',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      textSample: 'Hello world',
    }),
    click: vi.fn().mockResolvedValue({ ok: true }),
    type: vi.fn().mockResolvedValue({ ok: true }),
    scroll: vi.fn().mockResolvedValue({ ok: true }),
    waitFor: vi.fn().mockResolvedValue({ ok: true }),
    evaluateJs: vi.fn().mockResolvedValue({ ok: true, data: null }),
    findElements: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    screenshot: vi.fn().mockResolvedValue({ path: '/tmp/shot.png', mimeType: 'image/png', width: 800, height: 600 }),
    extractText: vi.fn().mockResolvedValue({ url: '', title: '', text: '', truncated: false }),
    newTab: vi.fn().mockResolvedValue({ id: 't2', title: 'New Tab', url: '', active: true, isLoading: false, isNewTab: true }),
    switchTab: vi.fn().mockResolvedValue(undefined),
    listTabs: vi.fn().mockResolvedValue([]),
    setBounds: vi.fn(),
    getExecutionMode: vi.fn(),
    open: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    closeTab: vi.fn(),
    matchHistory: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    listSessions: vi.fn(),
    clearSession: vi.fn(),
    on: vi.fn(),
    getPageInfo: vi.fn(),
  } as unknown as BrowserService;
}

const BASE_PARAMS = {
  apiKey: 'test-key',
  modelRegistryId: 'claude-haiku-4-5',
  userText: 'navigate to example.com',
  sessionMessages: [] as import('@anthropic-ai/sdk').MessageParam[],
  signal: new AbortController().signal,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('streamAnthropicChat — agentic tool loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default stream mock for non-tool path (returns empty)
    mockStream.mockReturnValue({
      on: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({}),
    });
  });

  it('calls browser.navigate when tool_use block is returned, then returns final text', async () => {
    const wc = makeWebContents();
    const browser = makeBrowser();

    // Turn 1: tool_use → navigate
    mockCreate
      .mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tu1', name: 'browser_navigate', input: { url: 'https://example.com' } },
        ],
        stop_reason: 'tool_use',
      })
      // Turn 2: final text
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done! I navigated to Example.' }],
        stop_reason: 'end_turn',
      });

    const result = await streamAnthropicChat({
      ...BASE_PARAMS,
      webContents: wc as unknown as import('electron').WebContents,
      sessionMessages: [],
      browserService: browser,
    });

    expect(browser.navigate).toHaveBeenCalledWith('https://example.com');
    expect(result.response).toBe('Done! I navigated to Example.');
    expect(result.error).toBeUndefined();
  });

  it('runs multiple tool turns before producing final text', async () => {
    const wc = makeWebContents();
    const browser = makeBrowser();

    mockCreate
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu1', name: 'browser_navigate', input: { url: 'https://a.com' } }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu2', name: 'browser_get_page_state', input: {} }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'All done.' }],
        stop_reason: 'end_turn',
      });

    const result = await streamAnthropicChat({
      ...BASE_PARAMS,
      webContents: wc as unknown as import('electron').WebContents,
      sessionMessages: [],
      browserService: browser,
    });

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(browser.navigate).toHaveBeenCalledTimes(1);
    expect(browser.getPageState).toHaveBeenCalledTimes(1);
    expect(result.response).toBe('All done.');
  });

  it('appends tool turns to sessionMessages', async () => {
    const wc = makeWebContents();
    const browser = makeBrowser();
    const sessionMessages: import('@anthropic-ai/sdk').MessageParam[] = [];

    mockCreate
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu1', name: 'browser_navigate', input: { url: 'https://b.com' } }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done.' }],
        stop_reason: 'end_turn',
      });

    await streamAnthropicChat({
      ...BASE_PARAMS,
      webContents: wc as unknown as import('electron').WebContents,
      sessionMessages,
      browserService: browser,
    });

    // user message + assistant tool_use + user tool_result + assistant final
    expect(sessionMessages.length).toBe(4);
    expect(sessionMessages[0].role).toBe('user');
    expect(sessionMessages[1].role).toBe('assistant');
    expect(sessionMessages[2].role).toBe('user');
    expect(sessionMessages[3].role).toBe('assistant');
  });

  it('uses streaming path (no create) when browserService is not provided', async () => {
    const wc = makeWebContents();

    const streamObj = {
      on: vi.fn((event: string, cb: (arg: string) => void) => {
        if (event === 'text') cb('Hello!');
      }),
      finalMessage: vi.fn().mockResolvedValue({}),
    };
    mockStream.mockReturnValue(streamObj);

    const result = await streamAnthropicChat({
      ...BASE_PARAMS,
      webContents: wc as unknown as import('electron').WebContents,
      sessionMessages: [],
      // No browserService
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockStream).toHaveBeenCalled();
    expect(result.response).toBe('Hello!');
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/main/anthropicChat.tool-loop.test.ts
```

Expected: 4 tests pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add tests/main/anthropicChat.tool-loop.test.ts
git commit -m "test: integration test for agentic browser tool-use loop"
```

---

## Task 6: Build verification

- [ ] **Step 1: Run the full test suite**

```bash
cd /home/dp/Desktop/clawdia7.0 && npm test
```

Expected: all tests pass (including pre-existing tests).

- [ ] **Step 2: TypeScript compile check**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix: address any type or build issues"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 13 tools defined. Tool executor, agentic loop, `browserService` injection, `CHAT_TOOL_ACTIVITY` events — all covered.
- [x] **No placeholders:** Every step has complete code.
- [x] **Type consistency:** `BrowserService` type used consistently from `BrowserService.ts`. `BROWSER_TOOLS` and `executeBrowserTool` exported from `browserTools.ts` and imported in `anthropicChat.ts`. `StreamParams.browserService` matches `BrowserService` interface. `tool_result` block shape matches Anthropic SDK `ToolResultBlockParam`.
- [x] **Backward compatible:** Streaming path unchanged when `browserService` is absent.
