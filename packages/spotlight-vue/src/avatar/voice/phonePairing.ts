export function isWeChatInAppBrowser(userAgent = ""): boolean {
  return /MicroMessenger|wxwork/i.test(userAgent);
}

/** Host app directory. Library builds freeze import.meta.env.BASE_URL as "/". */
export function voiceRemotePageDirectory(pathname: string): string {
  const withoutIndex = pathname.replace(/\/index\.html$/i, "/");
  if (withoutIndex.endsWith("/")) return withoutIndex || "/";
  const last = withoutIndex.split("/").pop() ?? "";
  if (last.includes(".")) {
    const slash = withoutIndex.lastIndexOf("/");
    return slash >= 0 ? withoutIndex.slice(0, slash + 1) : "/";
  }
  return `${withoutIndex}/`;
}

/** Phone remote URL on the same public origin as the GIS page. */
export function voiceRemotePageUrl(
  token: string,
  location: Pick<Location, "origin" | "pathname"> = window.location,
): string {
  const url = new URL(
    `${voiceRemotePageDirectory(location.pathname)}voice-remote.html`,
    location.origin,
  );
  url.searchParams.set("p", token);
  return url.toString();
}

export async function createVoiceRemoteSession(
  postJson: <T>(path: string, body: unknown) => Promise<T>,
): Promise<{ token: string; expiresAt: number }> {
  return postJson("/v1/voice-remote/sessions", {});
}

export async function pullVoiceRemoteUtterances(
  token: string,
  getJson: <T>(path: string) => Promise<T>,
): Promise<Array<{ id: string; text: string }>> {
  const payload = await getJson<{ utterances?: Array<{ id: string; text: string }> }>(
    `/v1/voice-remote/sessions/${encodeURIComponent(token)}/pending`,
  );
  return payload.utterances ?? [];
}
