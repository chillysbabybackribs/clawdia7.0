import React, { useCallback, useEffect, useRef, useState } from 'react';
import 'xterm/css/xterm.css';

type XTermTerminal = import('xterm').Terminal;
type FitAddon = import('@xterm/addon-fit').FitAddon;

const TERMINAL_THEME = {
  background: '#0d0d10',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  cursorAccent: '#0d0d10',
  selectionBackground: '#ffffff30',
  selectionForeground: undefined,
  black: '#1a1a2e',
  red: '#ff6b6b',
  green: '#69db7c',
  yellow: '#ffd43b',
  blue: '#74c0fc',
  magenta: '#da77f2',
  cyan: '#66d9e8',
  white: '#e4e4e7',
  brightBlack: '#4a4a5a',
  brightRed: '#ff8787',
  brightGreen: '#8ce99a',
  brightYellow: '#ffe066',
  brightBlue: '#a5d8ff',
  brightMagenta: '#e599f7',
  brightCyan: '#99e9f2',
  brightWhite: '#ffffff',
};

const MAX_HYDRATE_CHARS = 64_000;

function sliceRecentOutput(output: string): string {
  if (!output || output.length <= MAX_HYDRATE_CHARS) return output;
  const sliced = output.slice(-MAX_HYDRATE_CHARS);
  const newlineIdx = sliced.indexOf('\n');
  return newlineIdx >= 0 ? sliced.slice(newlineIdx + 1) : sliced;
}

interface TerminalPanelProps {
  visible: boolean;
  conversationId?: string | null;
}

export default function TerminalPanel({ visible, conversationId }: TerminalPanelProps) {
  const api = window.clawdia;
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const initializedSessionRef = useRef<string | null>(null);
  const sessionModeRef = useRef<'user_owned' | 'agent_owned' | 'handoff' | 'observe_only'>('user_owned');

  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [agentControlled, setAgentControlled] = useState(false);
  const [sessionId, setSessionId] = useState('main-terminal');
  const [sessionOwner, setSessionOwner] = useState<'user' | 'agent' | 'external_agent'>('user');
  const [sessionMode, setSessionMode] = useState<'user_owned' | 'agent_owned' | 'handoff' | 'observe_only'>('user_owned');
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [takeoverRequestedBy, setTakeoverRequestedBy] = useState<'user' | 'agent' | 'external_agent' | null>(null);

  useEffect(() => {
    sessionModeRef.current = sessionMode;
  }, [sessionMode]);

  useEffect(() => {
    let cancelled = false;
    api?.terminal?.isAvailable()
      .then((available) => {
        if (!cancelled) setIsAvailable(available);
      })
      .catch(() => {
        if (!cancelled) setIsAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api?.chat?.getActiveTerminalSession(conversationId || null)
      .then((result) => {
        if (!cancelled) setSessionId(result?.sessionId || 'main-terminal');
      })
      .catch(() => {
        if (!cancelled) setSessionId('main-terminal');
      });
    return () => {
      cancelled = true;
    };
  }, [api, conversationId]);

  useEffect(() => {
    if (!api?.chat?.onClaudeStatus || !conversationId) return;
    return api.chat.onClaudeStatus((payload) => {
      if (payload.conversationId !== conversationId) return;
      if (payload.sessionId) {
        setSessionId(payload.sessionId);
      }
    });
  }, [api, conversationId]);

  useEffect(() => {
    if (!containerRef.current || isAvailable === false) return;
    if (!visible && !termRef.current) return;
    if (initializedSessionRef.current === sessionId && termRef.current) return;

    let disposed = false;

    cleanupRef.current?.();
    cleanupRef.current = null;
    termRef.current = null;
    fitAddonRef.current = null;
    initializedSessionRef.current = null;

    const init = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        theme: TERMINAL_THEME,
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 10_000,
        allowTransparency: true,
        macOptionIsMeta: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      initializedSessionRef.current = sessionId;

      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      const snapshotBeforeSpawn = await api.terminal.getSnapshot(sessionId).catch(() => null);
      const shouldSpawn = sessionId === 'main-terminal';
      const result = snapshotBeforeSpawn?.connected
        ? { id: sessionId }
        : shouldSpawn
          ? await api.terminal.spawn(sessionId, dims ? { cols: dims.cols, rows: dims.rows } : undefined)
          : snapshotBeforeSpawn
            ? { id: sessionId }
            : null;
      if (!result) {
        term.writeln('\r\n\x1b[90m[Waiting for terminal session...]\x1b[0m');
        return;
      }

      const snapshot = await api.terminal.getSnapshot(sessionId).catch(() => null);
      if (snapshot?.output) {
        term.write(sliceRecentOutput(snapshot.output));
      }
      setIsConnected(!!snapshot?.connected);
      setAgentControlled(!!snapshot?.agentControlled);
      setSessionOwner(snapshot?.owner || 'user');
      setSessionMode(snapshot?.mode || 'user_owned');
      setActiveRun(snapshot?.activeRun || null);
      setTakeoverRequestedBy(snapshot?.takeoverRequestedBy || null);

      const inputDisposable = term.onData((data: string) => {
        if (sessionModeRef.current === 'agent_owned' || sessionModeRef.current === 'observe_only' || sessionModeRef.current === 'handoff') {
          return;
        }
        void api.terminal.write(sessionId, data, { source: 'user', conversationId: conversationId || undefined });
      });

      const unsubData = api.terminal.onData((payload) => {
        if (payload.id !== sessionId || !termRef.current) return;
        termRef.current.write(payload.data);
        setIsConnected(true);
      });

      const unsubExit = api.terminal.onExit((payload) => {
        if (payload.id !== sessionId || !termRef.current) return;
        termRef.current.writeln(`\r\n\x1b[90m[Process exited with code ${payload.code}]\x1b[0m`);
        setIsConnected(false);
        setAgentControlled(false);
        requestAnimationFrame(() => termRef.current?.scrollToBottom());
      });

      const unsubSessionState = api.terminal.onSessionState((payload) => {
        if (payload.id !== sessionId) return;
        setIsConnected(payload.connected);
        setAgentControlled(!!payload.agentControlled);
        setSessionOwner(payload.owner);
        setSessionMode(payload.mode);
        setActiveRun(payload.activeRun || null);
        setTakeoverRequestedBy(payload.takeoverRequestedBy || null);
      });

      let resizeRaf: number | null = null;
      const resizeHandler = () => {
        if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          if (!fitAddonRef.current) return;
          fitAddonRef.current.fit();
          const nextDims = fitAddonRef.current.proposeDimensions();
          if (nextDims) {
            void api.terminal.resize(sessionId, nextDims.cols, nextDims.rows);
          }
          termRef.current?.scrollToBottom();
        });
      };

      const resizeObserver = new ResizeObserver(resizeHandler);
      resizeObserver.observe(containerRef.current);
      requestAnimationFrame(() => {
        resizeHandler();
        term.scrollToBottom();
      });

      cleanupRef.current = () => {
        inputDisposable.dispose();
        unsubData();
        unsubExit();
        unsubSessionState();
        if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
        resizeObserver.disconnect();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
    };

    void init();

    return () => {
      disposed = true;
      if (initializedSessionRef.current !== sessionId) {
        cleanupRef.current?.();
        cleanupRef.current = null;
      }
    };
  }, [api, conversationId, isAvailable, sessionId, visible]);

  useEffect(() => {
    if (!visible || !fitAddonRef.current) return;
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims) {
        void api?.terminal?.resize(sessionId, dims.cols, dims.rows);
      }
      termRef.current?.scrollToBottom();
    });
  }, [api, sessionId, visible]);

  const handleRestart = useCallback(async () => {
    await api?.terminal?.kill(sessionId);
    setIsConnected(false);
    setAgentControlled(false);
    setSessionOwner('user');
    setSessionMode('user_owned');
    setActiveRun(null);
    setTakeoverRequestedBy(null);

    if (termRef.current) {
      termRef.current.clear();
      termRef.current.writeln('\x1b[90m[Restarting terminal...]\x1b[0m\r\n');
    }

    const dims = fitAddonRef.current?.proposeDimensions();
    const result = await api?.terminal?.spawn(sessionId, dims ? { cols: dims.cols, rows: dims.rows } : undefined);
    if (result) {
      setIsConnected(true);
    }
  }, [api, sessionId]);

  const handleRequestTakeover = useCallback(async () => {
    if (!api?.terminal) return;
    const ok = await api.terminal.requestTakeover(sessionId, 'user');
    if (ok) {
      const approved = window.confirm('Request terminal takeover from the running agent?');
      if (approved) {
        await api.terminal.acquire(sessionId, 'user', { mode: 'user_owned', conversationId: conversationId || undefined });
      }
    }
  }, [api, conversationId, sessionId]);

  if (isAvailable === false) {
    return (
      <div className={`flex flex-1 items-center justify-center bg-[#0d0d10] text-text-secondary ${visible ? '' : 'hidden'}`}>
        <div className="space-y-2 text-center">
          <div className="text-sm font-medium text-text-primary">Terminal Unavailable</div>
          <div className="max-w-xs text-xs">
            `node-pty` is not installed or failed to load. Run `npm install` and rebuild Electron native modules.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-1 flex-col overflow-hidden bg-[#0d0d10] ${visible ? '' : 'hidden'}`}>
      <div className="flex h-9 flex-shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0d0d10] px-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            {sessionId === 'main-terminal' ? 'Terminal' : 'Claude Terminal'}
          </span>
          {isConnected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" title="Connected" />}
          {agentControlled && (
            <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400/80">
              Agent running
            </span>
          )}
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
            {sessionOwner}
          </span>
          {activeRun && (
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
              run {activeRun.slice(0, 8)}
            </span>
          )}
          {takeoverRequestedBy && (
            <span className="rounded bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
              takeover requested by {takeoverRequestedBy}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sessionMode === 'agent_owned' && (
            <button
              onClick={handleRequestTakeover}
              className="rounded px-2 py-1 text-[10px] font-medium text-sky-200 transition-colors hover:bg-sky-400/10"
              title="Request terminal takeover"
            >
              Request takeover
            </button>
          )}
          <button
            onClick={handleRestart}
            className="rounded p-1 text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
            title="Restart terminal"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {(sessionMode === 'agent_owned' || sessionMode === 'handoff' || sessionMode === 'observe_only') && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 border-b border-white/[0.06] bg-[#0d0d10]/90 px-3 py-2 text-[11px] text-text-secondary">
            {sessionMode === 'agent_owned' ? 'Agent running. Terminal input is disabled.' : sessionMode === 'handoff' ? 'Takeover pending. Terminal input is paused.' : 'Observe only.'}
          </div>
        )}
        <div ref={containerRef} className="flex-1 overflow-hidden" style={{ padding: '4px 0 0 8px' }} />
      </div>
    </div>
  );
}
