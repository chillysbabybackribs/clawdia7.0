# Browser CLI Tool Dispatch — Design Spec

**Date:** 2026-03-25
**Status:** Approved

## Overview

Wire Clawdia's existing `BrowserService` capability layer into the Anthropic chat loop as native tool use, giving the LLM direct, structured control over the in-app browser.

## Architecture

The Anthropic chat loop in `anthropicChat.ts` becomes an agentic tool-use loop. When Claude emits a `tool_use` block, `streamAnthropicChat` executes the tool against an injected `BrowserService` instance, appends the `tool_result`, and re-requests the API until Claude emits a final text response with no tool calls.

`BrowserService` is injected as an optional param — when absent, tool use is disabled and existing behavior is unchanged (backward compatible).

## Tool Definitions

Defined in a new file `src/main/core/cli/browserTools.ts` as Anthropic tool schemas with a corresponding executor.

| Tool | Params | Returns |
|------|--------|---------|
| `browser_navigate` | `url: string` | `{url, title}` |
| `browser_click` | `selector: string` | `{ok, error?}` |
| `browser_type` | `selector: string, text: string, clearFirst?: boolean` | `{ok, error?}` |
| `browser_scroll` | `selector?: string, deltaY?: number` | `{ok, error?}` |
| `browser_wait_for` | `selector: string, timeoutMs?: number` | `{ok, error?}` |
| `browser_evaluate_js` | `expression: string` | `{ok, data?, error?}` |
| `browser_find_elements` | `selector: string, limit?: number` | `{ok, data?, error?}` |
| `browser_get_page_state` | — | `{url, title, textSample}` |
| `browser_screenshot` | — | `{path}` |
| `browser_new_tab` | `url?: string` | `{id, url, title}` |
| `browser_switch_tab` | `id: string` | `{ok}` |
| `browser_list_tabs` | — | `[{id, title, url, active}]` |
| `browser_extract_text` | — | `{url, title, text, truncated}` |

Observation is caller-controlled: tools return `ok/error` by default; the LLM calls `browser_get_page_state`, `browser_extract_text`, or `browser_screenshot` explicitly when it needs to observe state.

## Data Flow

```
User message → streamAnthropicChat (with tools array)
  → Anthropic API
  → tool_use block detected
    → execute against BrowserService
    → emit CHAT_TOOL_ACTIVITY event to renderer
    → append tool_result to messages
    → re-request Anthropic API
  → repeat until no tool_use blocks
  → stream final text response to renderer
```

## Files Changed

| File | Change |
|------|--------|
| `src/main/core/cli/browserTools.ts` | **New** — Anthropic tool schemas + executor mapping tool calls to BrowserService methods |
| `src/main/anthropicChat.ts` | **Extend** — add `browserService?` to `StreamParams`, add agentic tool loop |
| `src/main/registerIpc.ts` | **Extend** — pass `browserService` instance into `streamAnthropicChat` calls |
| `src/shared/types.ts` | **Extend** — add `ToolActivity` type if not present, for renderer tool activity events |

## Out of Scope

- Screenshot as vision input (base64 image in tool_result) — defer to optimization phase
- External CLI binary
- New IPC channels
- Renderer UI changes beyond existing tool activity display
