// src/main/agent/classify.ts
import type { AgentProfile, ToolGroup, ModelTier } from './types';

export function classify(
  message: string,
  forced?: Partial<AgentProfile>,
): AgentProfile {
  const lower = message.toLowerCase();
  const toolGroup = forced?.toolGroup ?? detectToolGroup(lower);
  const modelTier = forced?.modelTier ?? detectModelTier(lower, toolGroup);
  const isGreeting = forced?.isGreeting ?? detectGreeting(message.trim());
  return { toolGroup, modelTier, isGreeting };
}

function detectToolGroup(msg: string): ToolGroup {
  if (/click|screenshot|desktop|gui|window\s+app/.test(msg)) return 'desktop';
  if (/browser|search the web|navigate|url|website|http/.test(msg)) return 'browser';
  if (/code|debug|refactor|typescript|javascript|python|function|class|method|test|lint/.test(msg)) return 'coding';
  if (/\bfile\b|\bfolder\b|\bread\b|\bwrite\b|\bmove\b|\bcopy\b|\bdelete\b|\bdirectory\b/.test(msg)) return 'core';
  return 'full';
}

function detectModelTier(msg: string, group: ToolGroup): ModelTier {
  if (/\bquick\b|\bsimple\b|\bbrief\b|\bjust\b|\bshort\b/.test(msg)) return 'fast';
  if (group === 'desktop' || /\bthorough\b|\bdeep\b|\bcomplex\b|\bresearch\b|\banalyze\b|\banalysis\b/.test(msg)) return 'powerful';
  return 'standard';
}

function detectGreeting(msg: string): boolean {
  return /^(hi|hello|hey|thanks|thank you|bye|goodbye)(\s+there)?[\s!?.]*$/i.test(msg);
}
