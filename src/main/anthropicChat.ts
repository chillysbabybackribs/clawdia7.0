import Anthropic from '@anthropic-ai/sdk';
import type { WebContents } from 'electron';
import * as fs from 'fs';
import { IPC_EVENTS } from './ipc-channels';
import type { MessageAttachment } from '../shared/types';
import { BROWSER_TOOLS, executeBrowserTool } from './core/cli/browserTools';
import { executeShellTool } from './core/cli/shellTools';
import type { BrowserService } from './core/browser/BrowserService';
import { truncateBrowserResult, truncateToolResult, SHELL_MAX } from './core/cli/truncate';
import { SHARED_SYSTEM_PROMPT, ANTHROPIC_STREAM_SYSTEM_PROMPT } from './core/cli/systemPrompt';

/** Anthropic API accepts the same model ids as the in-app registry (e.g. claude-sonnet-4-6). */
export function resolveAnthropicModelId(registryId: string): string {
  return registryId;
}

function buildUserContent(
  text: string,
  attachments?: MessageAttachment[],
): string | Anthropic.ContentBlockParam[] {
  if (!attachments?.length) return text;

  const blocks: Anthropic.ContentBlockParam[] = [];

  for (const a of attachments) {
    if (a.kind === 'image' && (a.dataUrl || a.path)) {
      let base64 = '';
      let mediaType = a.mimeType || 'image/png';
      if (a.dataUrl) {
        const m = a.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (m) {
          mediaType = m[1];
          base64 = m[2];
        }
      } else if (a.path) {
        try {
          base64 = fs.readFileSync(a.path).toString('base64');
        } catch {
          continue;
        }
      }
      if (base64) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: base64,
          },
        });
      }
    } else if (a.textContent) {
      blocks.push({ type: 'text', text: `[Attachment: ${a.name}]\n${a.textContent}` });
    }
  }

  blocks.push({ type: 'text', text });
  return blocks;
}

function modelSupportsExtendedThinking(apiModelId: string): boolean {
  return (
    apiModelId.includes('claude-opus-4')
    || apiModelId.includes('claude-sonnet-4')
    || apiModelId.includes('claude-3-7')
  );
}

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

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

async function executeToolCall(block: Anthropic.ToolUseBlock): Promise<string> {
  try {
    if (block.name === 'bash') {
      const { command } = block.input as { command: string };
      const { stdout, stderr } = await execAsync(command);
      return stdout || stderr || 'Command executed successfully with no output.';
    }
    if (block.name === 'str_replace_based_edit_tool') {
      const input = block.input as any;
      const cmd = input.command;
      const filePath = input.path;
      if (cmd === 'view') {
        return fs.readFileSync(filePath, 'utf-8');
      }
      if (cmd === 'create') {
        fs.writeFileSync(filePath, input.file_text, 'utf-8');
        return `File created at ${filePath}`;
      }
      if (cmd === 'str_replace') {
        const text = fs.readFileSync(filePath, 'utf-8');
        const count = text.split(input.old_str).length - 1;
        if (count === 0) return 'Error: old_str not found in file.';
        if (count > 1) return 'Error: old_str found multiple times.';
        fs.writeFileSync(filePath, text.replace(input.old_str, input.new_str), 'utf-8');
        return 'File updated successfully.';
      }
      return `Executed ${cmd} on ${filePath} (limited implementation).`;
    }
    return `Error: Unknown tool ${block.name}`;
  } catch (err: any) {
    return `Error executing tool: ${err.message}`;
  }
}

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
  const client = new Anthropic({ apiKey });
  const apiModelId = resolveAnthropicModelId(modelRegistryId);
  const userContent = buildUserContent(userText, attachments);

  const userMessage: Anthropic.MessageParam = {
    role: 'user',
    content: userContent,
  };

  const sendThinking = (t: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_THINKING, t);
  };
  const sendText = (chunk: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, chunk);
  };

  sendThinking('Claude is thinking…');

  const tryThinking = modelSupportsExtendedThinking(apiModelId);

  const messagesForRequest: Anthropic.MessageParam[] = [...sessionMessages, userMessage];

  const runStream = async (withThinking: boolean): Promise<string> => {
    const body: Anthropic.MessageCreateParams = {
      model: apiModelId,
      max_tokens: 8192,
      messages: messagesForRequest,
      system: [
        {
          type: 'text' as const,
          text: ANTHROPIC_STREAM_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ] as any,
      tools: [
        { type: 'bash_20250124', name: 'bash' } as any,
        { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool', cache_control: { type: 'ephemeral' as const } } as any
      ],
    };

    if (withThinking && tryThinking) {
      (body as Anthropic.MessageCreateParams & { thinking: { type: 'enabled'; budget_tokens: number } }).thinking = {
        type: 'enabled',
        budget_tokens: 10_000,
      };
    }

    const stream = client.messages.stream(body, { signal });

    let fullText = '';
    let sawThinking = false;

    stream.on('text', (delta) => {
      fullText += delta;
      sendText(delta);
    });

    stream.on('thinking', (delta) => {
      const t = delta.trim();
      if (t) {
        sawThinking = true;
        sendThinking(t);
      }
    });

    await stream.finalMessage();

    if (!sawThinking && !fullText) {
      sendThinking('Composing a reply…');
    }

    return fullText;
  };

  // Shell tools in Anthropic custom-tool format (always loaded, cached)
  const ANTHROPIC_SHELL_TOOLS: Anthropic.Tool[] = [
    {
      name: 'shell_exec',
      description: 'Execute a bash shell command on the local system.',
      input_schema: { type: 'object' as const, properties: { command: { type: 'string', description: 'The shell command to run.' } }, required: ['command'] },
    },
    {
      name: 'file_edit',
      description: 'Read and edit files. command: view|create|str_replace. path: file path. file_text: content for create. old_str/new_str: for str_replace.',
      input_schema: { type: 'object' as const, properties: { command: { type: 'string' }, path: { type: 'string' }, file_text: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['command', 'path'] },
    },
    {
      name: 'file_list_directory',
      description: 'List the contents of a directory. Returns structured JSON with name, type, and size.',
      input_schema: { type: 'object' as const, properties: { path: { type: 'string', description: 'Absolute directory path to list.' } }, required: ['path'] },
    },
    {
      name: 'file_search',
      description: 'Search for a pattern in files. Returns structured JSON matches with file, line, text.',
      input_schema: { type: 'object' as const, properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } }, required: ['pattern'] },
    },
  ];

  /** Run one non-streaming tool-use turn and return the assistant message. */
  const runToolTurn = async (
    messages: Anthropic.MessageParam[],
  ): Promise<Anthropic.Message> => {
    // Shell tools are always loaded (small, always needed).
    // Browser tools are deferred — model searches via tool_search_tool_bm25.
    // defer_loading and cache_control are mutually exclusive per Anthropic API.
    const deferredBrowserTools = BROWSER_TOOLS.map(t => ({ ...t, defer_loading: true }));

    const body: Anthropic.MessageCreateParams = {
      model: apiModelId,
      max_tokens: 8192,
      messages,
      system: SHARED_SYSTEM_PROMPT,
      tools: [
        { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' } as any,
        ...ANTHROPIC_SHELL_TOOLS.map((t, i) =>
          i === ANTHROPIC_SHELL_TOOLS.length - 1
            ? { ...t, cache_control: { type: 'ephemeral' as const } }
            : t
        ),
        ...deferredBrowserTools,
      ] as any,
    };
    return client.messages.create(body, { signal });
  };

  const SHELL_TOOL_NAMES = new Set(['shell_exec', 'file_edit', 'file_list_directory', 'file_search']);

  /** Execute tool calls from an assistant message and return tool_result blocks. */
  const executeTools = async (
    toolUseBlocks: Anthropic.ToolUseBlock[],
    browser: BrowserService,
  ): Promise<Anthropic.ToolResultBlockParam[]> => {
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const startMs = Date.now();
      let resultContent: string;
      let isError = false;
      try {
        if (SHELL_TOOL_NAMES.has(block.name)) {
          resultContent = await executeShellTool(block.name, block.input as Record<string, unknown>);
        } else {
          const output = await executeBrowserTool(block.name, block.input as Record<string, unknown>, browser);
          resultContent = truncateBrowserResult(JSON.stringify(output));
          isError = (output as { ok?: boolean }).ok === false;
        }
      } catch (err) {
        resultContent = JSON.stringify({ ok: false, error: (err as Error).message });
        isError = true;
      }
      const durationMs = Date.now() - startMs;
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
          id: block.id,
          name: block.name,
          status: isError ? 'error' : 'success',
          detail: resultContent.slice(0, 200),
          durationMs,
        });
      }
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: resultContent,
      });
    }
    return results;
  };

  const sessionLengthBeforeRequest = sessionMessages.length;
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

        // server_tool_use = tool search calls handled server-side; skip client execution
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
        if (toolUseBlocks.length === 0) {
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

      if (turns >= MAX_TOOL_TURNS && assistantText === '') {
        assistantText = '[Browser tool loop reached maximum turn limit without producing a response.]';
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, assistantText);
        }
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
    sessionMessages.splice(sessionLengthBeforeRequest);
    if (!webContents.isDestroyed()) {
      webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
    }
    return { response: '', error: err.message };
  }
}
