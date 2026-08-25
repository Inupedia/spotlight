import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  CreateRunRequest,
  FrontendToolManifestV1,
  SpotlightCapabilitySession,
  SpotlightSkill,
  SpotlightSkillRegistration,
  SpotlightThread,
} from "@inupedia/spotlight-protocol";

export interface StoredCapabilitySession extends SpotlightCapabilitySession {
  toolManifest: FrontendToolManifestV1;
  registrations: SpotlightSkillRegistration[];
  skills: SpotlightSkill[];
}

export interface StoredTurn {
  id: string;
  threadId: string;
  request: CreateRunRequest;
  startedAt: number;
  completedAt?: number;
  status: "in_progress" | "completed" | "failed" | "interrupted";
  events: unknown[];
  finalResponse?: string;
}

interface StoredThreadRecord {
  thread: SpotlightThread;
  turnIds: string[];
}

interface DurableSnapshot {
  schemaVersion: 1;
  capabilities: Record<string, StoredCapabilitySession>;
  threads: Record<string, StoredThreadRecord>;
  turns: Record<string, StoredTurn>;
}

function emptySnapshot(): DurableSnapshot {
  return { schemaVersion: 1, capabilities: {}, threads: {}, turns: {} };
}

function safeClone<T>(value: T): T {
  return structuredClone(value);
}

/** Small durable control-plane store. LangGraph owns checkpoints; this owns product Threads. */
export class SpotlightDurableState {
  private snapshot: DurableSnapshot;
  private readonly filePath: string | null;

  constructor(stateDir?: string) {
    this.filePath = stateDir?.trim() ? join(stateDir, "spotlight-state.json") : null;
    this.snapshot = this.load();
  }

  private load(): DurableSnapshot {
    if (!this.filePath) return emptySnapshot();
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as DurableSnapshot;
      return parsed.schemaVersion === 1 ? parsed : emptySnapshot();
    } catch {
      return emptySnapshot();
    }
  }

  private flush(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.snapshot)}\n`, "utf8");
    renameSync(temporary, this.filePath);
  }

  createCapability(input: {
    projectId: string;
    manifest: FrontendToolManifestV1;
    registrations: SpotlightSkillRegistration[];
    skills: SpotlightSkill[];
    ttlMs?: number;
  }): StoredCapabilitySession {
    this.pruneCapabilities();
    const createdAt = Date.now();
    const id = randomUUID();
    const session: StoredCapabilitySession = {
      id,
      projectId: input.projectId,
      manifestDigest: input.manifest.manifestDigest,
      createdAt,
      expiresAt: createdAt + (input.ttlMs ?? 24 * 60 * 60_000),
      toolManifest: safeClone(input.manifest),
      registrations: safeClone(input.registrations),
      skills: safeClone(input.skills),
    };
    this.snapshot.capabilities[id] = session;
    this.flush();
    return safeClone(session);
  }

  getCapability(id: string | undefined): StoredCapabilitySession | null {
    if (!id) return null;
    const session = this.snapshot.capabilities[id];
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      delete this.snapshot.capabilities[id];
      this.flush();
      return null;
    }
    return safeClone(session);
  }

  private pruneCapabilities(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, session] of Object.entries(this.snapshot.capabilities)) {
      if (session.expiresAt <= now) {
        delete this.snapshot.capabilities[id];
        changed = true;
      }
    }
    if (changed) this.flush();
  }

  createThread(projectId: string, requestedId?: string): SpotlightThread {
    const id = requestedId?.trim() || randomUUID();
    const existing = this.snapshot.threads[id];
    if (existing) return safeClone(existing.thread);
    const now = Date.now();
    const thread: SpotlightThread = {
      id,
      projectId,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    this.snapshot.threads[id] = { thread, turnIds: [] };
    this.flush();
    return safeClone(thread);
  }

  getThread(id: string): SpotlightThread | null {
    return this.snapshot.threads[id]?.thread
      ? safeClone(this.snapshot.threads[id].thread)
      : null;
  }

  listThreads(projectId: string, includeArchived = false): SpotlightThread[] {
    return Object.values(this.snapshot.threads)
      .map((record) => record.thread)
      .filter((thread) => thread.projectId === projectId)
      .filter((thread) => includeArchived || !thread.archivedAt)
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      .map((thread) => safeClone(thread));
  }

  archiveThread(id: string): SpotlightThread | null {
    const record = this.snapshot.threads[id];
    if (!record) return null;
    const now = Date.now();
    record.thread = { ...record.thread, status: "closed", archivedAt: now, updatedAt: now };
    this.flush();
    return safeClone(record.thread);
  }

  forkThread(id: string): SpotlightThread | null {
    const source = this.snapshot.threads[id];
    if (!source) return null;
    const target = this.createThread(source.thread.projectId);
    const targetRecord = this.snapshot.threads[target.id];
    for (const sourceTurnId of source.turnIds) {
      const sourceTurn = this.snapshot.turns[sourceTurnId];
      if (!sourceTurn || sourceTurn.status === "in_progress") continue;
      const targetTurnId = randomUUID();
      this.snapshot.turns[targetTurnId] = {
        ...safeClone(sourceTurn),
        id: targetTurnId,
        threadId: target.id,
      };
      targetRecord.turnIds.push(targetTurnId);
    }
    targetRecord.thread.updatedAt = Date.now();
    this.flush();
    return safeClone(targetRecord.thread);
  }

  startTurn(turn: StoredTurn): void {
    const thread = this.snapshot.threads[turn.threadId];
    if (!thread) this.createThread(turn.request.projectId ?? "", turn.threadId);
    this.snapshot.turns[turn.id] = safeClone(turn);
    const record = this.snapshot.threads[turn.threadId];
    if (!record.turnIds.includes(turn.id)) record.turnIds.push(turn.id);
    record.thread.status = "running";
    record.thread.updatedAt = turn.startedAt;
    this.flush();
  }

  appendTurnEvent(turnId: string, event: unknown): void {
    const turn = this.snapshot.turns[turnId];
    if (!turn) return;
    turn.events.push(safeClone(event));
    this.flush();
  }

  finishTurn(
    turnId: string,
    status: StoredTurn["status"],
    finalResponse?: string,
  ): void {
    const turn = this.snapshot.turns[turnId];
    if (!turn) return;
    const now = Date.now();
    turn.status = status;
    turn.completedAt = now;
    turn.finalResponse = finalResponse;
    const thread = this.snapshot.threads[turn.threadId];
    if (thread) {
      thread.thread.status = thread.thread.archivedAt ? "closed" : "idle";
      thread.thread.updatedAt = now;
    }
    this.flush();
  }

  getTurn(id: string): StoredTurn | null {
    const turn = this.snapshot.turns[id];
    return turn ? safeClone(turn) : null;
  }

  threadTurns(threadId: string): StoredTurn[] {
    const record = this.snapshot.threads[threadId];
    if (!record) return [];
    return record.turnIds
      .map((id) => this.snapshot.turns[id])
      .filter((turn): turn is StoredTurn => Boolean(turn))
      .map((turn) => safeClone(turn));
  }

  /** Stable identifier useful in diagnostics without exposing state content. */
  snapshotDigest(): string {
    return createHash("sha256").update(JSON.stringify(this.snapshot)).digest("hex");
  }
}
