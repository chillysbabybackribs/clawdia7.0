import Anthropic from '@anthropic-ai/sdk';
import type { WebContents } from 'electron';
import * as fs from 'fs';
import { IPC_EVENTS } from './ipc-channels';
import type { MessageAttachment } from '../shared/types';

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
};

export async function streamAnthropicChat({
  webContents,
  apiKey,
  modelRegistryId,
  userText,
  attachments,
  sessionMessages,
  signal,
}: StreamParams): Promise<{ response: string; error?: string }> {
  const client = new Anthropic({ apiKey });
  const apiModelId = resolveAnthropicModelId(modelRegistryId);
  const userContent = buildUserContent(userText, attachments);

  const userMessage: Anthropic.MessageParam = {
    role: 'user',
    content: userContent,
  };

  const messagesForRequest = [...sessionMessages, userMessage];

  const sendThinking = (t: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_THINKING, t);
  };
  const sendText = (chunk: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, chunk);
  };

  sendThinking('Claude is thinking…');

  const tryThinking = modelSupportsExtendedThinking(apiModelId);

  const runStream = async (withThinking: boolean): Promise<string> => {
    const body: Anthropic.MessageCreateParams = {
      model: apiModelId,
      max_tokens: 8192,
      messages: messagesForRequest,
      system: `You have access to a local CLI environment. Use the native bash tool to execute shell commands and explore the system. Use the native text_editor tool to read and edit files. Use these tools efficiently to accomplish the user's tasks. Do not wait for user permission to use these tools unless it involves a destructive system change.`,
      tools: [
        { type: 'bash_20250124', name: 'bash' } as any,
        { type: 'text_editor_20250728', name: 'str_replace_editor' } as any
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

  try {
    sessionMessages.push(userMessage);

    let assistantText = '';
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

    sessionMessages.push({
      role: 'assistant',
      content: assistantText,
    });

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
}
