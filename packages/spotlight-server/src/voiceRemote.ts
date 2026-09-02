import { randomBytes } from "node:crypto";

export const VOICE_REMOTE_TOKEN_TTL_MS = 15 * 60_000;
const MAX_PENDING = 8;

export type VoiceRemoteUtterance = {
  id: string;
  text: string;
  at: number;
};

type VoiceRemoteSession = {
  token: string;
  projectId: string;
  createdAt: number;
  expiresAt: number;
  phoneSeenAt: number | null;
  pending: VoiceRemoteUtterance[];
};

export class VoiceRemoteRegistry {
  private readonly sessions = new Map<string, VoiceRemoteSession>();

  create(projectId: string, now = Date.now()): {
    token: string;
    expiresAt: number;
  } {
    this.prune(now);
    const token = randomBytes(18).toString("base64url");
    const session: VoiceRemoteSession = {
      token,
      projectId,
      createdAt: now,
      expiresAt: now + VOICE_REMOTE_TOKEN_TTL_MS,
      phoneSeenAt: null,
      pending: [],
    };
    this.sessions.set(token, session);
    return { token, expiresAt: session.expiresAt };
  }

  get(token: string, now = Date.now()): VoiceRemoteSession | null {
    const session = this.sessions.get(token.trim());
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  touchPhone(token: string, now = Date.now()): VoiceRemoteSession | null {
    const session = this.get(token, now);
    if (!session) return null;
    session.phoneSeenAt = now;
    session.expiresAt = Math.max(session.expiresAt, now + VOICE_REMOTE_TOKEN_TTL_MS);
    return session;
  }

  enqueue(token: string, text: string, now = Date.now()): VoiceRemoteUtterance | null {
    const session = this.touchPhone(token, now);
    if (!session) return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    const utterance: VoiceRemoteUtterance = {
      id: randomBytes(8).toString("hex"),
      text: trimmed.slice(0, 500),
      at: now,
    };
    session.pending.push(utterance);
    if (session.pending.length > MAX_PENDING) {
      session.pending.splice(0, session.pending.length - MAX_PENDING);
    }
    return utterance;
  }

  takePending(token: string, now = Date.now()): VoiceRemoteUtterance[] {
    const session = this.get(token, now);
    if (!session) return [];
    const pending = session.pending.splice(0, session.pending.length);
    return pending;
  }

  publicView(token: string, now = Date.now()) {
    const session = this.get(token, now);
    if (!session) return null;
    return {
      ok: true as const,
      projectId: session.projectId,
      expiresAt: session.expiresAt,
      phoneConnected: session.phoneSeenAt != null && now - session.phoneSeenAt < 45_000,
    };
  }

  private prune(now: number): void {
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }
  }
}

export function isVoiceRemotePublicPath(path: string): boolean {
  const pathname = path.split("?")[0] ?? path;
  return (
    /^\/v1\/voice-remote\/sessions\/[^/]+$/.test(pathname) ||
    /^\/v1\/voice-remote\/sessions\/[^/]+\/(utterance|pending|heartbeat)$/.test(
      pathname,
    )
  );
}
