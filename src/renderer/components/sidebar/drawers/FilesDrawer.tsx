import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface FsEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

interface FilesDrawerProps {
  onAddContext: (text: string, filePath: string) => void;
  onOpenFile: (filePath: string) => void;
}

const PINNED = [
  { label: 'Home', path: '~' },
  { label: 'Desktop', path: '~/Desktop' },
  { label: 'Downloads', path: '~/Downloads' },
];

function sortEntries(items: FsEntry[]): FsEntry[] {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function normalizeSearch(search: string): string {
  return search.trim().toLowerCase();
}

function FileTreeChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className={`flex-shrink-0 text-text-tertiary transition-transform ${expanded ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2.5L8 6L4 9.5" />
    </svg>
  );
}

function FolderGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className="flex-shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1.75 3.25h4.1l1.2 1.5h7.2v1.1H1.75z"
        fill={open ? '#fbbf24' : '#f59e0b'}
        opacity={open ? 0.95 : 0.9}
      />
      <path
        d="M1.5 5.35C1.5 4.95 1.82 4.63 2.22 4.63h11.56c.4 0 .72.32.72.72v6.2c0 .66-.54 1.2-1.2 1.2H2.7c-.66 0-1.2-.54-1.2-1.2z"
        fill={open ? '#fcd34d' : '#fbbf24'}
      />
      <path
        d="M1.5 5.45h13"
        stroke={open ? '#fde68a' : '#fcd34d'}
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FileGlyph({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const icon = fileTypeIcon(ext);
  return (
    <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center" aria-hidden="true">
      {icon}
    </span>
  );
}

function FileBase({
  accent,
  detail,
}: {
  accent: string;
  detail?: React.ReactNode;
}) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M3.25 1.75h5.2l3.05 3.05v8.45a1 1 0 0 1-1 1H3.25a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1z" fill="#101826" />
      <path d="M8.45 1.75V4.8h3.05" fill={accent} fillOpacity="0.92" />
      <path d="M8.45 1.75V4.8h3.05" stroke={accent} strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M3.25 1.75h5.2l3.05 3.05v8.45a1 1 0 0 1-1 1H3.25a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1z" stroke="#475569" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M4.2 11.85h5.85" stroke={accent} strokeWidth="1" strokeLinecap="round" />
      <path d="M4.2 9.9h5.85" stroke="#64748b" strokeWidth="0.8" strokeLinecap="round" />
      {detail}
    </svg>
  );
}

function fileTypeIcon(ext: string): React.ReactNode {
  switch (ext) {
    case 'ts':
    case 'tsx':
      return (
        <FileBase
          accent="#38bdf8"
          detail={<text x="4.15" y="8.1" fontSize="3.2" fontWeight="700" fill="#38bdf8">TS</text>}
        />
      );
    case 'js':
    case 'jsx':
      return (
        <FileBase
          accent="#facc15"
          detail={<text x="4.15" y="8.1" fontSize="3.2" fontWeight="700" fill="#facc15">JS</text>}
        />
      );
    case 'json':
      return (
        <FileBase
          accent="#34d399"
          detail={<text x="4.15" y="8.1" fontSize="3.2" fontWeight="700" fill="#34d399">{'{ }'}</text>}
        />
      );
    case 'md':
      return (
        <FileBase
          accent="#a78bfa"
          detail={<path d="M4.1 7.2h1.25l.9 1.15.9-1.15h1.25v2.5H7.5V8.35L6.3 9.82 5.1 8.35V9.7H4.1z" fill="#c4b5fd" />}
        />
      );
    case 'py':
      return (
        <FileBase
          accent="#60a5fa"
          detail={
            <>
              <path d="M4.45 7.15a1.05 1.05 0 0 1 1.05-1.05h1.55a.7.7 0 0 1 .7.7v.7a.7.7 0 0 1-.7.7H5.4a.95.95 0 0 0-.95.95v.2H6.8a1.05 1.05 0 0 1 1.05 1.05" stroke="#93c5fd" strokeWidth="0.8" strokeLinecap="round" />
              <circle cx="6.55" cy="6.8" r="0.4" fill="#93c5fd" />
              <circle cx="5.55" cy="10.1" r="0.4" fill="#93c5fd" />
            </>
          }
        />
      );
    case 'sh':
      return (
        <FileBase
          accent="#84cc16"
          detail={
            <>
              <path d="M4.25 7.15 5.6 8.2 4.25 9.25" stroke="#bef264" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6.35 9.3h2.05" stroke="#bef264" strokeWidth="0.9" strokeLinecap="round" />
            </>
          }
        />
      );
    case 'css':
      return (
        <FileBase
          accent="#22d3ee"
          detail={<text x="3.75" y="8.1" fontSize="3.1" fontWeight="700" fill="#67e8f9">CSS</text>}
        />
      );
    case 'html':
      return (
        <FileBase
          accent="#fb923c"
          detail={
            <>
              <path d="M4.2 8.05 5.3 7.1M4.2 8.05 5.3 9M7.9 7.05 6.95 9.1M9.55 8.05 8.45 7.1M9.55 8.05 8.45 9" stroke="#fdba74" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" />
            </>
          }
        />
      );
    case 'pdf':
      return (
        <FileBase
          accent="#f87171"
          detail={<text x="3.95" y="8.1" fontSize="3.1" fontWeight="700" fill="#fca5a5">PDF</text>}
        />
      );
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return (
        <FileBase
          accent="#f472b6"
          detail={
            <>
              <circle cx="5.15" cy="7.05" r="0.75" fill="#f9a8d4" />
              <path d="M4.2 10.05 5.7 8.65l1.2 1.05 1.35-1.55 1.55 1.9" stroke="#f9a8d4" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" />
            </>
          }
        />
      );
    case 'zip':
    case 'tar':
    case 'gz':
      return (
        <FileBase
          accent="#a8a29e"
          detail={
            <>
              <path d="M6.4 6.2v3.25" stroke="#d6d3d1" strokeWidth="0.85" strokeLinecap="round" />
              <path d="M5.6 6.65h1.6M5.6 7.6h1.6M5.6 8.55h1.6" stroke="#d6d3d1" strokeWidth="0.8" strokeLinecap="round" />
            </>
          }
        />
      );
    default:
      return (
        <FileBase
          accent="#94a3b8"
          detail={<path d="M4.35 7.15h4.55M4.35 8.2h4.55" stroke="#cbd5e1" strokeWidth="0.85" strokeLinecap="round" />}
        />
      );
  }
}

export default function FilesDrawer({ onAddContext, onOpenFile }: FilesDrawerProps) {
  const [root, setRoot] = useState('~');
  const [rootEntries, setRootEntries] = useState<FsEntry[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FsEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [attaching, setAttaching] = useState<string | null>(null);
  const api = (window as any).clawdia;

  const loadDirectory = useCallback(async (dirPath: string): Promise<FsEntry[]> => {
    if (!api) return [];
    try {
      const items: FsEntry[] = await api.fs.readDir(dirPath);
      return sortEntries(items);
    } catch {
      return [];
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = await loadDirectory(root);
      if (cancelled) return;
      setRootEntries(items);
      setChildrenByPath({});
      setExpandedPaths({});
      setLoadingPaths({});
    })();
    return () => {
      cancelled = true;
    };
  }, [root, loadDirectory]);

  const ensureChildrenLoaded = useCallback(async (dirPath: string): Promise<FsEntry[]> => {
    if (childrenByPath[dirPath]) return childrenByPath[dirPath];
    setLoadingPaths((prev) => ({ ...prev, [dirPath]: true }));
    const items = await loadDirectory(dirPath);
    setChildrenByPath((prev) => ({ ...prev, [dirPath]: items }));
    setLoadingPaths((prev) => {
      const next = { ...prev };
      delete next[dirPath];
      return next;
    });
    return items;
  }, [childrenByPath, loadDirectory]);

  const toggleDir = useCallback(async (entry: FsEntry) => {
    if (expandedPaths[entry.path]) {
      setExpandedPaths((prev) => ({ ...prev, [entry.path]: false }));
      return;
    }
    await ensureChildrenLoaded(entry.path);
    setExpandedPaths((prev) => ({ ...prev, [entry.path]: true }));
  }, [ensureChildrenLoaded, expandedPaths]);

  const handleFileClick = useCallback(async (entry: FsEntry) => {
    onOpenFile(entry.path);
  }, [onOpenFile]);

  const handleAttachClick = useCallback(async (entry: FsEntry) => {
    if (!api) return;
    setAttaching(entry.path);
    try {
      const content: string = await api.fs.readFile(entry.path);
      onAddContext(content, entry.path);
    } catch (err: any) {
      if (err?.message?.includes('too large')) {
        alert(`File too large to attach (max 500KB): ${entry.name}`);
      }
    } finally {
      setAttaching(null);
    }
  }, [api, onAddContext]);

  const normalizedSearch = useMemo(() => normalizeSearch(search), [search]);

  const matchesSearch = useCallback((entry: FsEntry): boolean => {
    if (!normalizedSearch) return true;
    return entry.name.toLowerCase().includes(normalizedSearch);
  }, [normalizedSearch]);

  const hasVisibleDescendant = useCallback((entry: FsEntry): boolean => {
    const children = childrenByPath[entry.path] || [];
    return children.some((child) => matchesSearch(child) || (child.type === 'dir' && hasVisibleDescendant(child)));
  }, [childrenByPath, matchesSearch]);

  const shouldRenderEntry = useCallback((entry: FsEntry): boolean => {
    if (!normalizedSearch) return true;
    if (matchesSearch(entry)) return true;
    if (entry.type === 'dir') return hasVisibleDescendant(entry);
    return false;
  }, [hasVisibleDescendant, matchesSearch, normalizedSearch]);

  const visibleRootEntries = useMemo(
    () => rootEntries.filter((entry) => shouldRenderEntry(entry)),
    [rootEntries, shouldRenderEntry],
  );

  function renderEntry(entry: FsEntry, depth = 0): React.ReactNode {
    if (!shouldRenderEntry(entry)) return null;

    const isDir = entry.type === 'dir';
    const isExpanded = !!expandedPaths[entry.path];
    const children = childrenByPath[entry.path] || [];
    const isLoading = !!loadingPaths[entry.path];
    const isAttaching = attaching === entry.path;
    const rowDepth = 10 + depth * 14;

    return (
      <React.Fragment key={entry.path}>
        <button
          type="button"
          onClick={() => (isDir ? toggleDir(entry) : handleFileClick(entry))}
          className={`no-drag group flex w-full items-center gap-1.5 rounded-none border-l border-transparent py-1 pr-2 text-left transition-colors ${
            isAttaching
              ? 'bg-accent/10 border-l-accent'
              : 'hover:bg-border-subtle'
          }`}
          style={{ paddingLeft: `${rowDepth}px` }}
        >
          <span className="flex w-3 items-center justify-center">
            {isDir ? <FileTreeChevron expanded={isExpanded} /> : <span className="block h-3 w-3" />}
          </span>
          {isDir ? <FolderGlyph open={isExpanded} /> : <FileGlyph name={entry.name} />}
          <span className={`min-w-0 flex-1 truncate text-[11px] ${isDir ? 'text-text-primary' : 'text-text-secondary'}`}>
            {entry.name}
          </span>
          {!isDir && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handleAttachClick(entry);
              }}
              className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-[1px] text-[9px] text-slate-400 opacity-0 transition-all hover:bg-white/[0.08] hover:text-white group-hover:opacity-100"
              title="Attach file to chat context"
            >
              Add
            </button>
          )}
          {isLoading && (
            <span className="flex-shrink-0 text-[9px] text-text-muted">…</span>
          )}
          {isAttaching && (
            <span className="flex-shrink-0 text-[9px] text-accent">Attach</span>
          )}
        </button>
        {isDir && isExpanded && (
          <div className="relative">
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-border"
              style={{ left: `${rowDepth + 7}px` }}
            />
            {children.filter((child) => shouldRenderEntry(child)).map((child) => renderEntry(child, depth + 1))}
            {!isLoading && children.length === 0 && (
              <div
                className="py-1 text-[10px] italic text-text-muted"
                style={{ paddingLeft: `${rowDepth + 20}px` }}
              >
                Empty folder
              </div>
            )}
          </div>
        )}
      </React.Fragment>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 border-b border-border px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold text-text-primary">Files</div>
          <div className="rounded bg-surface-1 px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            Explorer
          </div>
        </div>
        <div className="relative">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Filter current tree..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-[26px] w-full rounded border border-border bg-border-subtle pl-7 pr-2 text-[11px] text-text-primary placeholder-text-tertiary outline-none transition-all focus:border-accent/30"
          />
        </div>
      </div>

      <div className="flex-shrink-0 px-2 py-2">
        <div className="px-1 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
          Quick Access
        </div>
        <div className="space-y-1">
          {PINNED.map(({ label, path }) => {
            const active = root === path;
            return (
              <button
                key={path}
                type="button"
                onClick={() => {
                  setRoot(path);
                  setSearch('');
                }}
                className={`no-drag flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                  active
                    ? 'bg-accent/10 text-text-primary'
                    : 'text-text-secondary hover:bg-border-subtle'
                }`}
              >
                <span className="text-[11px]">{label === 'Home' ? '⌂' : label === 'Desktop' ? '□' : '↓'}</span>
                <span className="text-[11px]">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-3 h-px bg-surface-1" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 border-b border-border bg-surface-0/95 px-3 py-2 backdrop-blur-sm">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Current Root</div>
          <div className="mt-1 truncate text-[11px] text-text-primary">{root}</div>
        </div>

        <div className="px-1 py-2">
          {visibleRootEntries.map((entry) => renderEntry(entry))}
          {visibleRootEntries.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-text-muted">
              {normalizedSearch ? 'No matching files or folders in the loaded tree.' : 'Empty folder'}
            </div>
          )}
        </div>

        <div className="mx-3 h-px bg-surface-1" />
        <div className="px-3 pb-3 pt-2 text-[10px] leading-4 text-text-muted">
          Expand folders to browse deeper. Click a file to open it in the editor, or use Add to attach it to chat context.
        </div>
      </div>
    </div>
  );
}
