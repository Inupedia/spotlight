export function timeoutSignal(timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

export async function upstreamError(response: Response): Promise<string> {
  const detail = await response.text().catch(() => "");
  return detail || `HTTP ${response.status}`;
}
