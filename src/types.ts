export interface SearchResult {
  content: string;
  path: string;
  title: string;
  href: string;
}

export interface DocsExpertResponse {
  content: string;
  messageId: string;
  searchResults: SearchResult[];
  suggestions: string[];
  usage: Record<string, number> | null;
}

export interface Message {
  id: string;
  createdAt: string;
  role: "user" | "assistant";
  content: string;
  parts: Array<{ type: "text"; text: string }>;
}

export interface DocsExpertOptions {
  subdomain?: string;
  filterGroups?: string[];
  filterVersion?: string;
  currentPath?: string;
}

export interface StreamLine {
  type: string;
  data: unknown;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "searchResults"; results: SearchResult[] }
  | { type: "done"; response: DocsExpertResponse };
