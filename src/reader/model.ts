export type ReaderMode = "document" | "search" | "toc" | "confirmExternal" | "help" | "directory";

export type ReaderHistoryEntry = {
  path: string;
  scrollRow: number;
  focusedLinkId: string | null;
};

export type ReaderSearch = {
  query: string;
  rows: number[];
  index: number;
};

export type ReaderModel = {
  mode: ReaderMode;
  rootPath: string;
  currentPath: string;
  title: string;
  scrollRow: number;
  focusedLinkId: string | null;
  history: ReaderHistoryEntry[];
  historyIndex: number;
  search: ReaderSearch | null;
  pendingExternalUrl: string | null;
  message: string | null;
};

export type ViewportSize = {
  cols: number;
  rows: number;
  /** Number of rows reserved below document content. */
  statusRows: number;
};
