import OpenAI from 'openai';
import type { WebContents } from 'electron';
import * as fs from 'fs';
import { IPC_EVENTS } from './ipc-channels';
import type { MessageAttachment } from '../shared/types';

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;

function buildUserContent(
  text: string,
  attachments?: MessageAttachment[],
): string | OpenAI.Chat.ChatCompletionContentPart[] {
  if (!attachments?.length) return text;

  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (const a of attachments) {
    if (a.kind === 'image' && (a.dataUrl || a.path)) {
      let dataUrl = a.dataUrl;
      if (!dataUrl && a.path) {
        try {
          const b64 = fs.readFileSync(a.path).toString('base64');
          const mime = a.mimeType || 'image/png';
          dataUrl = `data:${mime};base64,${b64}`;
        } catch {
          continue;
        }
      }
      if (dataUrl) {
        parts.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    } else if (a.textContent) {
      parts.push({ type: 'text', text: `[Attachment: ${a.name}]\n${a.textContent}` });
    }
  }

  parts.push({ type: 'text', text });
  return parts;
}

type StreamParams = {
  webContents: WebContents;
  apiKey: string;
  modelRegistryId: string;
  userText: string;
  attachments?: MessageAttachment[];
  sessionMessages: OpenAIMessage[];
  signal: AbortSignal;
};

export async function streamOpenAIChat({
  webContents,
  apiKey,
  modelRegistryId,
  userText,
  attachments,
  sessionMessages,
  signal,
}: StreamParams): Promise<{ response: string; error?: string }> {
  const client = new OpenAI({ apiKey });

  const userContent = buildUserContent(userText, attachments);
  const userMessage: OpenAIMessage = { role: 'user', content: userContent };

  const sendThinking = (t: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_THINKING, t);
  };
  const sendText = (chunk: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, chunk);
  };

  sendThinking('GPT is thinking…');

  const sessionLengthBeforeRequest = sessionMessages.length;

  try {
    sessionMessages.push(userMessage);

    const stream = await client.chat.completions.create(
      {
        model: modelRegistryId,
        messages: sessionMessages,
        stream: true,
      },
      { signal },
    );

    let fullText = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        sendText(delta);
      }
    }

    sessionMessages.push({ role: 'assistant', content: fullText });

    if (!webContents.isDestroyed()) {
      webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });
    }

    return { response: fullText };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === 'AbortError' || (err as NodeJS.ErrnoException).code === 'ERR_CANCELED') {
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
