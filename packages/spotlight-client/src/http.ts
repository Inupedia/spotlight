/** Spotlight HTTP client configuration (env-agnostic). */
export interface SpotlightClientConfig {
  serverUrl: string;
  apiKey?: string;
  projectId: string;
}

export class SpotlightHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryable?: boolean,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "SpotlightHttpError";
  }
}

function responseError(method: string, path: string, status: number, text: string) {
  let parsed: {
    error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
    message?: string;
  } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // Non-JSON reverse-proxy errors still receive a useful fallback below.
  }
  const error = parsed.error;
  return new SpotlightHttpError(
    error?.message ?? parsed.message ?? `Spotlight ${method} ${path} failed: ${status}`,
    status,
    error?.code,
    error?.retryable,
    error?.details,
  );
}

export function normalizeServerUrl(url: string): string {
  return url.replace(/\/$/, "");
}

export function resolveSpotlightClientConfig(
  partial: Partial<SpotlightClientConfig> & Pick<SpotlightClientConfig, "projectId">,
): SpotlightClientConfig {
  return {
    serverUrl: normalizeServerUrl(partial.serverUrl ?? "/spotlight-api"),
    apiKey: partial.apiKey?.trim() || undefined,
    projectId: partial.projectId.trim(),
  };
}

export function buildJsonHeaders(config: SpotlightClientConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = config.apiKey?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export function appendProjectQuery(
  config: SpotlightClientConfig,
  path: string,
): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}projectId=${encodeURIComponent(config.projectId)}`;
}

export function createSpotlightHttp(config: SpotlightClientConfig) {
  const normalized = resolveSpotlightClientConfig(config);
  const base = normalizeServerUrl(normalized.serverUrl);

  return {
    config: normalized,
    getBase: () => base,
    jsonHeaders: () => buildJsonHeaders(normalized),
    appendProjectQuery: (path: string) => appendProjectQuery(normalized, path),
    async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
      const res = await fetch(`${base}${path}`, {
        headers: buildJsonHeaders(normalized),
        signal,
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw responseError("GET", path, res.status, text);
      }
      return JSON.parse(text) as T;
    },
    async postJson<T>(
      path: string,
      body: unknown,
      signal?: AbortSignal,
    ): Promise<T> {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: buildJsonHeaders(normalized),
        body: JSON.stringify(body ?? {}),
        signal,
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw responseError("POST", path, res.status, text);
      }
      return JSON.parse(text) as T;
    },
  };
}

export type SpotlightHttp = ReturnType<typeof createSpotlightHttp>;
