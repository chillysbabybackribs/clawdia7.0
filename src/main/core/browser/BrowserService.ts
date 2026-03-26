export type BrowserExecutionMode = 'headed' | 'headless' | 'persistent_session';

export interface BrowserViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserTabState {
  id: string;
  title: string;
  url: string;
  active: boolean;
  isLoading: boolean;
  faviconUrl?: string;
  isNewTab: boolean;
}

export interface BrowserPageState {
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  textSample: string;
}

export interface BrowserNavigationResult {
  tabId: string;
  url: string;
  title: string;
}

export interface BrowserScreenshotResult {
  path: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface BrowserServiceResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface BrowserServiceEvents {
  urlChanged: (url: string) => void;
  titleChanged: (title: string) => void;
  loadingChanged: (loading: boolean) => void;
  tabsChanged: (tabs: BrowserTabState[]) => void;
  modeChanged: (payload: { mode: BrowserExecutionMode }) => void;
}

export interface BrowserService {
  // Browser panel/view control lives here and is intentionally distinct from
  // brokered browser capability actions such as navigate/extract/screenshot.
  setBounds(bounds: BrowserViewportBounds): void;
  getExecutionMode(): Promise<BrowserExecutionMode>;
  open(url?: string): Promise<BrowserNavigationResult>;
  navigate(url: string): Promise<BrowserNavigationResult>;
  back(): Promise<void>;
  forward(): Promise<void>;
  refresh(): Promise<void>;
  newTab(url?: string): Promise<BrowserTabState>;
  listTabs(): Promise<BrowserTabState[]>;
  switchTab(id: string): Promise<void>;
  closeTab(id: string): Promise<void>;
  matchHistory(prefix: string): Promise<string | null>;
  hide(): Promise<void>;
  show(): Promise<void>;
  getPageState(): Promise<BrowserPageState>;
  extractText(): Promise<{ url: string; title: string; text: string }>;
  screenshot(): Promise<BrowserScreenshotResult>;
  /** Click an element identified by CSS selector */
  click(selector: string): Promise<BrowserServiceResult>;
  /** Type text into an element identified by CSS selector. If clearFirst, clears existing value first. */
  type(selector: string, text: string, clearFirst?: boolean): Promise<BrowserServiceResult>;
  /** Scroll to an element by CSS selector (or scroll window by deltaY pixels if selector is null) */
  scroll(selector: string | null, deltaY?: number): Promise<BrowserServiceResult>;
  /** Wait until a CSS selector is present in DOM. Returns error on timeout. */
  waitFor(selector: string, timeoutMs?: number): Promise<BrowserServiceResult>;
  /** Evaluate a JS expression in the page context and return the serializable result */
  evaluateJs(expression: string): Promise<BrowserServiceResult>;
  /** Return { url, title, readyState } of current page */
  getPageInfo(): Promise<BrowserServiceResult>;
  /** Find elements matching a CSS selector, return array of { tag, text, attrs } */
  findElements(selector: string, limit?: number): Promise<BrowserServiceResult>;
  // Session maintenance is currently treated as browser UI/session management,
  // not as a brokered capability mutation.
  listSessions(): Promise<string[]>;
  clearSession(domain: string): Promise<void>;
  on<K extends keyof BrowserServiceEvents>(event: K, listener: BrowserServiceEvents[K]): () => void;
}
