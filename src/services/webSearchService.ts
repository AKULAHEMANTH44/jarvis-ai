import {
  PermissionRequest,
  WebSearchProviderId,
  WebSearchResponse,
  WebSearchResultItem
} from '../types/assistant';
import { PermissionManager, permissionManager as defaultPermissionManager } from './permissionManager';
import { validateNavigationUrl } from './browserActionService';

export interface ExtractedSearchIntent {
  query: string;
  provider: WebSearchProviderId;
  ambiguous: boolean;
  clarificationQuestion?: string;
  displayDescription: string;
}

const DEICTIC_ONLY = new Set([
  'it',
  'this',
  'that',
  'something',
  'anything',
  'them',
  'more',
  'info',
  'information',
  'the web',
  'web',
  'online',
  'internet',
  'google',
  'duckduckgo',
  'wikipedia',
  'mdn',
  'github'
]);

export function extractSearchIntent(rawInput: string): ExtractedSearchIntent {
  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();

  let provider: WebSearchProviderId = 'DUCKDUCKGO';
  if (/\b(wikipedia|wiki)\b/i.test(lower)) provider = 'WIKIPEDIA';
  else if (/\b(mdn|mozilla)\b/i.test(lower)) provider = 'MDN';
  else if (/\b(github|repo|repository)\b/i.test(lower)) provider = 'GITHUB';
  else if (/\b(google)\b/i.test(lower)) provider = 'GOOGLE';

  let query = trimmed
    .replace(/^(?:hey\s+|hi\s+|please\s+)?(?:jarvis[,\s]+)?/i, '')
    .replace(
      /^(?:can you\s+|please\s+|could you\s+)?(?:search\s+(?:the\s+web\s+|online\s+|google\s+|duckduckgo\s+|wikipedia\s+)?for|search\s+about|find\s+information\s+(?:about|on)|find\s+(?:info|details)\s+(?:about|on)|find\s+documentation\s+for|look\s+up|research|web\s+search(?:\s+for)?|search)\s*/i,
      ''
    )
    .replace(/^(?:the\s+web|online|on\s+the\s+web)$/i, '')
    .replace(/\s+(?:on\s+(?:google|duckduckgo|wikipedia|mdn|github)|online|on\s+the\s+web)\.?$/i, '')
    .replace(/[.?!]+$/, '')
    .trim();

  // Preserve documentation context when user asked "Find documentation for X"
  if (/\bdocumentation\b/i.test(trimmed) && query && !/\bdocumentation|docs\b/i.test(query)) {
    query = `${query} documentation`;
  }

  // Detect ambiguous or empty search queries
  if (
    !query ||
    DEICTIC_ONLY.has(query.toLowerCase()) ||
    /^(?:search(?:\s+the\s+web)?|find\s+information|look\s+up|research|web\s+search)$/i.test(trimmed)
  ) {
    return {
      query: '',
      provider,
      ambiguous: true,
      clarificationQuestion: 'What exact topic or keywords would you like me to search the web for?',
      displayDescription: 'Ambiguous web search request'
    };
  }

  return {
    query,
    provider,
    ambiguous: false,
    displayDescription: `Search the web (${provider}) for "${query}"`
  };
}

export function buildSearchUrl(query: string, provider: WebSearchProviderId = 'DUCKDUCKGO'): string {
  const q = encodeURIComponent(query.trim());
  switch (provider) {
    case 'GOOGLE':
      return `https://www.google.com/search?q=${q}`;
    case 'WIKIPEDIA':
      return `https://en.wikipedia.org/w/index.php?search=${q}`;
    case 'MDN':
      return `https://developer.mozilla.org/en-US/search?q=${q}`;
    case 'GITHUB':
      return `https://github.com/search?q=${q}`;
    case 'DUCKDUCKGO':
    default:
      return `https://duckduckgo.com/?q=${q}`;
  }
}

export class WebSearchService {
  private permissionMgr: PermissionManager;
  private activeAbortController: AbortController | null = null;

  constructor(permissionMgr: PermissionManager = defaultPermissionManager) {
    this.permissionMgr = permissionMgr;
  }

  public requestSearchPermission(
    query: string,
    provider: WebSearchProviderId = 'DUCKDUCKGO',
    reason?: string
  ): PermissionRequest {
    const cleanQuery = query.trim();
    const searchUrl = buildSearchUrl(cleanQuery, provider);
    return this.permissionMgr.createRequest({
      category: 'WEB_SEARCH',
      requestedAction: `Search the web via ${provider}`,
      target: cleanQuery,
      reason: reason || `Search ${provider} for "${cleanQuery}"`,
      riskLevel: 'LOW',
      requestedScope: `Single web search query "${cleanQuery}" via ${provider}`,
      metadata: {
        provider,
        searchUrl
      }
    });
  }

  public cancelActiveSearch(): boolean {
    if (!this.activeAbortController) return false;
    this.activeAbortController.abort();
    this.activeAbortController = null;
    return true;
  }

  public async executeApprovedSearch(
    query: string,
    permissionId: string,
    options: {
      provider?: WebSearchProviderId;
      signal?: AbortSignal;
      openInBrowserFallback?: boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<WebSearchResponse> {
    const cleanQuery = query.trim();
    const provider = options.provider || 'DUCKDUCKGO';
    const searchUrl = buildSearchUrl(cleanQuery, provider);

    const distinctionNotice =
      'Search results originate from external public web sources and are distinct from verified local workspace facts.';

    if (!cleanQuery) {
      return {
        ok: false,
        query: '',
        provider,
        searchUrl,
        results: [],
        distinctionNotice,
        error: 'Search query cannot be empty.'
      };
    }

    const auth = this.permissionMgr.beginAuthorizedExecution(permissionId, 'WEB_SEARCH', cleanQuery);
    if (!auth.authorized) {
      return {
        ok: false,
        query: cleanQuery,
        provider,
        searchUrl,
        results: [],
        distinctionNotice,
        error: auth.error || 'Explicit search permission required.'
      };
    }

    const controller = new AbortController();
    this.activeAbortController = controller;
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    const timeoutMs = options.timeoutMs ?? 8000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      if (options.signal?.aborted) {
        this.permissionMgr.cancel(permissionId, 'Web search cancelled by user before network fetch.');
        return {
          ok: false,
          query: cleanQuery,
          provider,
          searchUrl,
          results: [],
          cancelled: true,
          distinctionNotice,
          error: 'Search cancelled by user.'
        };
      }

      const results: WebSearchResultItem[] = [];
      let sourceSummary: string | undefined;
      let networkError: string | undefined;

      // Query CORS-friendly HTTPS public knowledge endpoints where available (Wikipedia / DuckDuckGo)
      if (typeof fetch === 'function') {
        try {
          if (provider === 'WIKIPEDIA' || provider === 'DUCKDUCKGO') {
            const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
              cleanQuery
            )}&limit=5&namespace=0&format=json&origin=*`;
            const res = await fetch(wikiUrl, { method: 'GET', signal: controller.signal });
            if (res.ok) {
              const json = (await res.json()) as [string, string[], string[], string[]];
              const titles = Array.isArray(json[1]) ? json[1] : [];
              const snippets = Array.isArray(json[2]) ? json[2] : [];
              const urls = Array.isArray(json[3]) ? json[3] : [];
              for (let i = 0; i < titles.length; i++) {
                const candidateUrl = urls[i] || '';
                const validated = validateNavigationUrl(candidateUrl);
                if (validated.valid && validated.normalizedUrl) {
                  results.push({
                    title: titles[i],
                    url: validated.normalizedUrl,
                    snippet: snippets[i] || `Wikipedia entry for ${titles[i]}`,
                    source: 'Wikipedia'
                  });
                }
              }
            }
          }

          if (results.length === 0 && provider === 'DUCKDUCKGO') {
            const ddgApi = `https://api.duckduckgo.com/?q=${encodeURIComponent(
              cleanQuery
            )}&format=json&no_html=1&skip_disambig=1`;
            const res = await fetch(ddgApi, { method: 'GET', signal: controller.signal });
            if (res.ok) {
              const data = (await res.json()) as {
                Heading?: string;
                AbstractText?: string;
                AbstractURL?: string;
                AbstractSource?: string;
                RelatedTopics?: { Text?: string; FirstURL?: string }[];
              };
              if (data.AbstractText && data.AbstractURL) {
                const v = validateNavigationUrl(data.AbstractURL);
                if (v.valid && v.normalizedUrl) {
                  results.push({
                    title: data.Heading || cleanQuery,
                    url: v.normalizedUrl,
                    snippet: data.AbstractText,
                    source: data.AbstractSource || 'DuckDuckGo Instant Answer'
                  });
                  sourceSummary = data.AbstractText;
                }
              }
              if (Array.isArray(data.RelatedTopics)) {
                for (const item of data.RelatedTopics.slice(0, 4)) {
                  if (item.FirstURL && item.Text) {
                    const v = validateNavigationUrl(item.FirstURL);
                    if (v.valid && v.normalizedUrl) {
                      results.push({
                        title: item.Text.split(' - ')[0] || cleanQuery,
                        url: v.normalizedUrl,
                        snippet: item.Text,
                        source: 'DuckDuckGo'
                      });
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          if (controller.signal.aborted && !timedOut) {
            this.permissionMgr.cancel(permissionId, 'Search cancelled by user.');
            return {
              ok: false,
              query: cleanQuery,
              provider,
              searchUrl,
              results: [],
              cancelled: true,
              distinctionNotice,
              error: 'Search cancelled by user.'
            };
          }
          networkError = timedOut
            ? `Search request timed out after ${Math.round(timeoutMs / 1000)}s.`
            : err instanceof Error
            ? err.message
            : 'Network search request failed.';
        }
      }

      if (!sourceSummary && results.length > 0) {
        const snippetsWithText = results.filter((r) => r.snippet && r.snippet.trim().length > 15);
        if (snippetsWithText.length > 0) {
          sourceSummary = snippetsWithText
            .slice(0, 2)
            .map((r) => `${r.title}: ${r.snippet}`)
            .join(' ');
        }
      }

      // If no live API results were retrieved and browser fallback is permitted, open the approved search page
      let openedInBrowser = false;
      let popupBlocked = false;
      if ((results.length === 0 || options.openInBrowserFallback) && typeof window !== 'undefined' && typeof window.open === 'function') {
        const opened = window.open(searchUrl, '_blank', 'noopener,noreferrer');
        if (opened) {
          openedInBrowser = true;
        } else {
          popupBlocked = true;
        }
      }

      if (results.length > 0 || openedInBrowser) {
        const summaryMsg =
          results.length > 0
            ? `Search completed: retrieved ${results.length} source result(s) for "${cleanQuery}".`
            : `Search completed: opened "${cleanQuery}" on ${provider} in a new browser tab.`;
        this.permissionMgr.completeExecution(permissionId, true, summaryMsg);
        return {
          ok: true,
          query: cleanQuery,
          provider,
          searchUrl,
          results,
          sourceSummary,
          openedInBrowser,
          popupBlocked,
          distinctionNotice
        };
      }

      const failMsg =
        networkError ||
        (popupBlocked
          ? `Unable to fetch search snippets and popup blocker prevented opening ${provider}. Use the verified search link directly.`
          : `No live source results returned and browser tab could not be opened.`);
      this.permissionMgr.completeExecution(permissionId, false, failMsg, failMsg);
      return {
        ok: false,
        query: cleanQuery,
        provider,
        searchUrl,
        results: [],
        openedInBrowser: false,
        popupBlocked,
        distinctionNotice,
        error: failMsg
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
    }
  }
}

export const webSearchService = new WebSearchService();
