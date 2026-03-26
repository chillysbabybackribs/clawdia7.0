import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface EditorTab {
  id: string;
  filePath: string;
}

interface TabEditorState {
  content: string;
  loading: boolean;
  error: string | null;
  editorValue: string;
  saving: boolean;
  saveMessage: string | null;
  externalChangePending: boolean;
  loadedPath: string | null;
}

interface EditorPanelProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onDirtyStateChange?: (tabId: string, dirty: boolean) => void;
}

const EMPTY_TAB_STATE: TabEditorState = {
  content: '',
  loading: false,
  error: null,
  editorValue: '',
  saving: false,
  saveMessage: null,
  externalChangePending: false,
  loadedPath: null,
};

export default function EditorPanel({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onDirtyStateChange,
}: EditorPanelProps) {
  const [tabStateById, setTabStateById] = useState<Record<string, TabEditorState>>({});
  const ignoreExternalChangeUntilRef = useRef<Record<string, number>>({});
  const dirtyStateRef = useRef<Record<string, boolean>>({});

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const activeState = activeTabId ? (tabStateById[activeTabId] || EMPTY_TAB_STATE) : EMPTY_TAB_STATE;
  const activeFilePath = activeTab?.filePath || null;
  const activeFileName = useMemo(
    () => activeFilePath?.split('/').filter(Boolean).pop() || 'Untitled',
    [activeFilePath],
  );
  const language = useMemo(() => inferMonacoLanguage(activeFilePath), [activeFilePath]);
  const isDirty = !!(activeTabId && activeState.editorValue !== activeState.content);

  const updateTabState = (tabId: string, updater: (state: TabEditorState) => TabEditorState) => {
    setTabStateById((current) => {
      const prev = current[tabId] || EMPTY_TAB_STATE;
      return { ...current, [tabId]: updater(prev) };
    });
  };

  const loadFileFromDisk = async (tabId: string, filePath: string) => {
    const api = (window as any).clawdia;
    if (!api?.fs?.readFile) return;

    updateTabState(tabId, (state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const text: string = await api.fs.readFile(filePath);
      setTabStateById((current) => ({
        ...current,
        [tabId]: {
          ...(current[tabId] || EMPTY_TAB_STATE),
          content: text,
          editorValue: text,
          loading: false,
          error: null,
          saveMessage: null,
          externalChangePending: false,
          loadedPath: filePath,
        },
      }));
    } catch (err: any) {
      const message = err?.message?.includes('too large')
        ? 'File is too large for inline preview right now.'
        : (err?.message || 'Unable to load file.');
      setTabStateById((current) => ({
        ...current,
        [tabId]: {
          ...(current[tabId] || EMPTY_TAB_STATE),
          content: '',
          editorValue: '',
          loading: false,
          error: message,
          loadedPath: filePath,
        },
      }));
    }
  };

  useEffect(() => {
    setTabStateById((current) => {
      const next: Record<string, TabEditorState> = {};
      for (const tab of tabs) {
        next[tab.id] = current[tab.id] || { ...EMPTY_TAB_STATE };
      }
      return next;
    });
  }, [tabs]);

  useEffect(() => {
    if (!activeTabId || !activeFilePath) return;
    const currentState = tabStateById[activeTabId];
    if (currentState?.loadedPath === activeFilePath) return;
    void loadFileFromDisk(activeTabId, activeFilePath);
  }, [activeFilePath, activeTabId, tabStateById]);

  useEffect(() => {
    const nextDirty: Record<string, boolean> = {};
    for (const tab of tabs) {
      const tabState = tabStateById[tab.id];
      const dirty = !!tabState && tabState.editorValue !== tabState.content;
      nextDirty[tab.id] = dirty;
      if (dirtyStateRef.current[tab.id] !== dirty) {
        onDirtyStateChange?.(tab.id, dirty);
      }
    }
    dirtyStateRef.current = nextDirty;
  }, [onDirtyStateChange, tabStateById, tabs]);

  const handleSave = async () => {
    if (!activeTabId || !activeFilePath || !isDirty || activeState.saving) return;
    const api = (window as any).clawdia;
    if (!api?.fs?.writeFile) return;

    updateTabState(activeTabId, (state) => ({
      ...state,
      saving: true,
      saveMessage: null,
    }));

    try {
      ignoreExternalChangeUntilRef.current[activeTabId] = Date.now() + 1200;
      await api.fs.writeFile(activeFilePath, activeState.editorValue);
      updateTabState(activeTabId, (state) => ({
        ...state,
        content: state.editorValue,
        saving: false,
        saveMessage: 'Saved',
        externalChangePending: false,
      }));
    } catch (err: any) {
      updateTabState(activeTabId, (state) => ({
        ...state,
        saving: false,
        saveMessage: err?.message || 'Save failed',
      }));
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!activeTabId || !activeFilePath || !api?.editor?.watchFile || !api?.editor?.onFileChanged) return;

    api.editor.watchFile(activeFilePath).catch(() => {});
    const unsubscribe = api.editor.onFileChanged((payload: { filePath: string }) => {
      if (!payload?.filePath || payload.filePath !== activeFilePath) return;
      if (Date.now() < (ignoreExternalChangeUntilRef.current[activeTabId] || 0)) return;

      const latestState = (tabStateById[activeTabId] || EMPTY_TAB_STATE);
      const latestDirty = latestState.editorValue !== latestState.content;
      if (latestDirty) {
        updateTabState(activeTabId, (state) => ({
          ...state,
          externalChangePending: true,
          saveMessage: 'File changed on disk',
        }));
        return;
      }

      void loadFileFromDisk(activeTabId, activeFilePath).then(() => {
        updateTabState(activeTabId, (state) => ({
          ...state,
          saveMessage: 'Reloaded from disk',
        }));
      });
    });

    return () => {
      unsubscribe?.();
      api.editor.unwatchFile?.().catch(() => {});
    };
  }, [activeFilePath, activeTabId, tabStateById]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0 text-text-primary">
      <div className="border-b border-border-subtle bg-surface-1 px-3 py-2 shadow-[inset_0_-1px_6px_rgba(0,0,0,0.2),0_2px_8px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
            {tabs.length > 0 ? tabs.map((tab) => {
              const tabState = tabStateById[tab.id] || EMPTY_TAB_STATE;
              const tabDirty = tabState.editorValue !== tabState.content;
              const tabName = tab.filePath.split('/').filter(Boolean).pop() || 'Untitled';
              const active = tab.id === activeTabId;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={`group inline-flex max-w-[220px] items-center gap-2 rounded-t-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-border border-b-transparent bg-surface shadow-[0_8px_18px_rgba(0,0,0,0.18)]'
                      : 'border-transparent bg-transparent text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
                  }`}
                >
                  <span className={`truncate text-[12px] font-medium ${active ? 'text-text-primary' : 'text-inherit'}`}>
                    {tabName}
                  </span>
                  {tabDirty && <span className="h-1.5 w-1.5 rounded-full bg-text-secondary" />}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        onCloseTab(tab.id);
                      }
                    }}
                    className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
                    aria-label={`Close ${tabName}`}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M2 2l8 8" />
                      <path d="M10 2L2 10" />
                    </svg>
                  </span>
                </button>
              );
            }) : (
              <div className="text-[12px] text-text-tertiary">No file open</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeFilePath && activeState.externalChangePending && (
              <button
                type="button"
                onClick={() => void loadFileFromDisk(activeTabId!, activeFilePath)}
                className="rounded border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:bg-white/[0.08] hover:text-text-primary"
              >
                Reload
              </button>
            )}
            {activeFilePath && (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!isDirty || activeState.saving}
                className="rounded border border-accent/20 bg-accent/[0.12] px-2.5 py-1 text-[11px] text-accent transition-colors hover:bg-accent/[0.18] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {activeState.saving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
          <div className="min-h-0 flex-1 overflow-auto bg-surface-0">
            {!activeFilePath && (
              <div className="flex h-full items-center justify-center px-6 text-center text-[13px] leading-6 text-text-tertiary">
                The editor pane is ready. Click a file in the sidebar to open it in a new tab.
              </div>
            )}
            {activeFilePath && activeState.error && (
              <div className="px-4 py-4 text-[13px] leading-6 text-accent">
                {activeState.error}
              </div>
            )}
            {activeFilePath && !activeState.error && activeState.externalChangePending && (
              <div className="border-b border-amber-400/12 bg-amber-400/[0.06] px-4 py-2 text-[11px] text-amber-200">
                This file changed on disk. Reload to sync the editor.
              </div>
            )}
            {activeFilePath && !activeState.error && (
              <Suspense
                fallback={
                  <pre className="min-h-full whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12px] leading-6 text-text-secondary">
                    {activeState.loading ? 'Loading...' : activeState.content}
                  </pre>
                }
              >
                <MonacoEditor
                  key={activeTabId}
                  path={activeFilePath}
                  theme="vs-dark"
                  language={language}
                  value={activeState.editorValue}
                  onChange={(value) => {
                    if (!activeTabId) return;
                    updateTabState(activeTabId, (state) => ({
                      ...state,
                      editorValue: value ?? '',
                      saveMessage: null,
                    }));
                  }}
                  loading={<div className="px-4 py-4 text-[12px] text-text-tertiary">Loading editor...</div>}
                  options={{
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineHeight: 22,
                    readOnly: false,
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    renderWhitespace: 'selection',
                    padding: { top: 16, bottom: 16 },
                  }}
                />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function inferMonacoLanguage(filePath?: string | null): string {
  const ext = filePath?.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts': return 'typescript';
    case 'tsx': return 'typescript';
    case 'js': return 'javascript';
    case 'jsx': return 'javascript';
    case 'json': return 'json';
    case 'md': return 'markdown';
    case 'py': return 'python';
    case 'sh': return 'shell';
    case 'css': return 'css';
    case 'html': return 'html';
    case 'xml': return 'xml';
    case 'yml':
    case 'yaml': return 'yaml';
    default: return 'plaintext';
  }
}
