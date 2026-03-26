import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ProviderId } from '../shared/model-registry';
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_PROVIDER } from '../shared/model-registry';
import type { PerformanceStance } from '../shared/types';

export interface AppSettings {
  providerKeys: Record<ProviderId, string>;
  provider: ProviderId;
  models: Record<ProviderId, string>;
  uiSession: unknown;
  unrestrictedMode: boolean;
  policyProfile: string;
  performanceStance: PerformanceStance;
}

const emptyKeys = (): Record<ProviderId, string> => ({
  anthropic: '',
  openai: '',
  gemini: '',
});

function defaultSettings(): AppSettings {
  return {
    providerKeys: emptyKeys(),
    provider: DEFAULT_PROVIDER,
    models: { ...DEFAULT_MODEL_BY_PROVIDER },
    uiSession: null,
    unrestrictedMode: false,
    policyProfile: 'standard',
    performanceStance: 'standard',
  };
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'clawdia-settings.json');
}

let cache: AppSettings | null = null;

export function loadSettings(): AppSettings {
  if (cache) return cache;
  const p = settingsPath();
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      cache = { ...defaultSettings(), ...parsed, providerKeys: { ...emptyKeys(), ...parsed.providerKeys } };
      return cache;
    }
  } catch {
    // fall through
  }
  cache = defaultSettings();
  return cache;
}

export function saveSettings(next: AppSettings): void {
  cache = next;
  const p = settingsPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // ignore disk errors
  }
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadSettings()[key];
}

export function patchSettings(patch: Partial<AppSettings>): AppSettings {
  const cur = loadSettings();
  const next: AppSettings = {
    ...cur,
    ...patch,
    providerKeys: patch.providerKeys ? { ...cur.providerKeys, ...patch.providerKeys } : cur.providerKeys,
    models: patch.models ? { ...cur.models, ...patch.models } : cur.models,
  };
  saveSettings(next);
  return next;
}
