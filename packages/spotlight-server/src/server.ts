import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyReply } from "fastify";
import { readFileSync } from "node:fs";
import type {
  FrontendToolDescriptorV1,
  HostToolResultRequest,
  SpotlightInitializeRequest,
  SpotlightInitializeResponse,
  SpotlightSkillRegistration,
  SpotlightThreadStartRequest,
  SpotlightTurn,
  SpotlightTurnEvent,
  SpotlightTurnStartRequest,
} from "@inupedia/spotlight-protocol";
import {
  SPOTLIGHT_APP_PROTOCOL_V1,
  deriveToolTier,
} from "@inupedia/spotlight-protocol";
import type { RunManager } from "./runManager.js";
import { SpotlightLifecycleProjector } from "./lifecycleAdapter.js";
import {
  assertRegisterableClientTools,
  UnsupportedToolTierError,
} from "./safety.js";

export const SPOTLIGHT_SERVER_VERSION = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

export interface BuildServerOptions {
  runManager: RunManager;
  projectId: string;
  apiKeys?: string[];
  corsOrigin?: string | string[];
  uiPrompts?: Record<string, unknown>;
  videoChannels?: Array<{ id: string; name: string; aliases: string[] }>;
}

function writeSse(reply: FastifyReply, event: unknown, seq?: number): void {
  const id = seq === undefined ? "" : `id: ${seq}\n`;
  reply.raw.write(`${id}data: ${JSON.stringify(event)}\n\n`);
}

function initializeResponse(
  request: SpotlightInitializeRequest,
  options: BuildServerOptions,
): SpotlightInitializeResponse {
  const readyBrowserTools = new Set(
    request.toolManifest.tools
      .filter((tool) => deriveToolTier(tool) !== "mutate")
      .map((tool) => tool.name),
  );
  const serverTools = new Set(options.runManager.listServerToolNames());
  const tools = request.toolManifest.tools.map((tool) => {
    const unsupported = deriveToolTier(tool) === "mutate";
    return {
      name: tool.name,
      target: "browser" as const,
      status: unsupported ? "unsupported" as const : "ready" as const,
      ...(unsupported
        ? { reason: "Mutating client Tools require acknowledgement and reconciliation support" }
        : {}),
    };
  });
  const skills = (request.skills ?? []).map((skill: SpotlightSkillRegistration) => {
    const dependencies = (skill.dependencies?.tools ?? []).map((tool) =>
      typeof tool === "string" ? tool : tool.value,
    );
    const missingTools = dependencies.filter(
      (name) => !readyBrowserTools.has(name) && !serverTools.has(name),
    );
    return {
      name: skill.name,
      status: missingTools.length === 0 ? "ready" as const : "missing" as const,
      missingTools,
      allowImplicitInvocation: skill.allowImplicitInvocation !== false,
      ...(missingTools.length > 0
        ? { reason: `Missing tool dependencies: ${missingTools.join(", ")}` }
        : {}),
    };
  });
  return {
    protocolVersion: SPOTLIGHT_APP_PROTOCOL_V1,
    serverInfo: {
      name: "@inupedia/spotlight-server",
      version: SPOTLIGHT_SERVER_VERSION,
      runtime: "langchain-langgraph",
    },
    projectId: options.projectId,
    acceptedManifestDigest: request.toolManifest.manifestDigest,
    capabilities: {
      transports: ["sse"],
      cancellation: true,
      threadResume: true,
      eventReplay: true,
    },
    tools,
    skills,
  };
}

/**
 * Where to resume an event stream. `Last-Event-ID` is set automatically by
 * EventSource; the query parameter lets a fetch-based reader do the same.
 */
function resumeCursor(
  header: string | string[] | undefined,
  query: unknown,
): number {
  const raw =
    (typeof header === "string" ? header : header?.[0]) ??
    (typeof query === "string" ? query : undefined);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function buildServer(options: BuildServerOptions) {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  await app.register(cors, {
    origin: options.corsOrigin ?? "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Spotlight-Api-Key",
      "Last-Event-ID",
    ],
  });
  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health" || !options.apiKeys?.length) return;
    const direct = request.headers["x-spotlight-api-key"];
    const authorization = request.headers.authorization;
    const supplied =
      typeof direct === "string"
        ? direct
        : authorization?.startsWith("Bearer ")
          ? authorization.slice(7)
          : undefined;
    if (!supplied || !options.apiKeys.includes(supplied)) {
      await reply
        .status(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } });
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "@inupedia/spotlight-server",
    version: SPOTLIGHT_SERVER_VERSION,
    runtime: "langchain-langgraph",
    projectId: options.projectId,
  }));
  app.get("/v1/meta/host-tools", async () => ({
    version: SPOTLIGHT_SERVER_VERSION,
    tools: [],
  }));
  app.get("/v1/meta/ui-prompts", async () => ({
    projectId: options.projectId,
    prompts: options.uiPrompts ?? {
      capabilityHelpPatterns: [],
      suggestionChips: { default: ["你能做什么"] },
    },
  }));
  app.get("/v1/meta/video-channels", async () => ({
    projectId: options.projectId,
    channels: options.videoChannels ?? [],
  }));

  app.post<{ Body: SpotlightInitializeRequest }>(
    "/v1/initialize",
    async (request, reply) => {
      const body = request.body;
      if (body?.protocolVersion !== SPOTLIGHT_APP_PROTOCOL_V1) {
        return reply.status(400).send({
          error: {
            code: "PROTOCOL_VERSION_UNSUPPORTED",
            message: `Expected ${SPOTLIGHT_APP_PROTOCOL_V1}`,
          },
        });
      }
      if (body.projectId !== options.projectId) {
        return reply.status(403).send({
          error: { code: "PROJECT_FORBIDDEN", message: "Project is not loaded" },
        });
      }
      if (body.toolManifest?.projectId !== options.projectId) {
        return reply.status(400).send({
          error: { code: "MANIFEST_PROJECT_MISMATCH", message: "Tool manifest project does not match" },
        });
      }
      return initializeResponse(body, options);
    },
  );

  app.post<{ Body: SpotlightThreadStartRequest }>(
    "/v1/threads",
    async (request, reply) => {
      if (request.body?.projectId !== options.projectId) {
        return reply.status(403).send({
          error: { code: "PROJECT_FORBIDDEN", message: "Project is not loaded" },
        });
      }
      return {
        thread: {
          id: request.body.threadId?.trim() || crypto.randomUUID(),
          projectId: options.projectId,
          status: "idle",
          createdAt: Date.now(),
        },
      };
    },
  );

  app.post<{ Params: { threadId: string }; Body: SpotlightTurnStartRequest }>(
    "/v1/threads/:threadId/turns",
    async (request, reply) => {
      const body = request.body;
      if (typeof body?.input !== "string" || !body.input.trim()) {
        return reply.status(400).send({
          error: { code: "BAD_REQUEST", message: "input is required" },
        });
      }
      if (body.projectId && body.projectId !== options.projectId) {
        return reply.status(403).send({
          error: { code: "PROJECT_FORBIDDEN", message: "Project is not loaded" },
        });
      }
      const manifestTools = body.clientToolManifest?.tools ?? [];
      try {
        assertRegisterableClientTools(manifestTools);
      } catch (error) {
        if (!(error instanceof UnsupportedToolTierError)) throw error;
        return reply.status(400).send({
          error: {
            code: "TOOL_TIER_UNSUPPORTED",
            message: error.message,
            retryable: false,
            details: { tools: error.tools },
          },
        });
      }
      const { input, ...rest } = body;
      const run = options.runManager.createRun({
        ...rest,
        projectId: options.projectId,
        sessionId: request.params.threadId,
        userQuestion: input,
      });
      const state = options.runManager.getRun(run.id)!;
      const turn: SpotlightTurn = {
        id: run.id,
        threadId: request.params.threadId,
        status: "in_progress",
        startedAt: state.startedAt,
      };
      return { turn };
    },
  );

  app.get<{ Params: { turnId: string }; Querystring: { lastEventId?: string } }>(
    "/v1/turns/:turnId/events",
    async (request, reply) => {
      const state = options.runManager.getRun(request.params.turnId);
      if (!state) {
        const expired = options.runManager.isExpired(request.params.turnId);
        return reply.status(expired ? 410 : 404).send({
          error: expired
            ? { code: "TURN_EXPIRED", message: "Turn is no longer retained" }
            : { code: "TURN_NOT_FOUND", message: "Turn not found" },
        });
      }
      const afterSeq = resumeCursor(
        request.headers["last-event-id"],
        request.query?.lastEventId,
      );
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.hijack();
      const projector = new SpotlightLifecycleProjector(
        state.sessionId ?? state.id,
        state.id,
        state.startedAt,
        state.request.skills,
      );
      const send = (event: SpotlightTurnEvent) => {
        if (event.seq <= afterSeq) return;
        writeSse(reply, event, event.seq);
      };
      send(projector.startEvent());
      let unsubscribe: (() => void) | null = null;
      let heartbeat: NodeJS.Timeout | null = null;
      unsubscribe = options.runManager.subscribe(state.id, (legacyEvent) => {
        for (const event of projector.project(legacyEvent)) {
          send(event);
          if (event.type === "turn.completed" || event.type === "turn.failed") {
            if (heartbeat) clearInterval(heartbeat);
            unsubscribe?.();
            reply.raw.end();
          }
        }
      });
      if (!reply.raw.writableEnded) {
        heartbeat = setInterval(
          () => writeSse(reply, {
            type: "ping",
            at: Date.now(),
            threadId: state.sessionId ?? state.id,
            turnId: state.id,
          }),
          15_000,
        );
        heartbeat.unref();
      }
      request.raw.on("close", () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
      });
    },
  );

  app.post<{ Params: { turnId: string }; Body: HostToolResultRequest }>(
    "/v1/turns/:turnId/tool-results",
    async (request, reply) => options.runManager.completeHostAction(
      request.params.turnId,
      request.body,
    )
      ? { ok: true }
      : reply.status(404).send({ error: { code: "CLIENT_TOOL_CALL_NOT_FOUND" } }),
  );

  app.delete<{ Params: { turnId: string } }>(
    "/v1/turns/:turnId",
    async (request, reply) => options.runManager.cancelRun(request.params.turnId)
      ? { ok: true }
      : reply.status(404).send({ error: { code: "TURN_NOT_FOUND" } }),
  );

  app.post<{ Body: Record<string, unknown> }>(
    "/v1/runs",
    async (request, reply) => {
      const body = request.body;
      if (typeof body?.userQuestion !== "string" || !body.userQuestion.trim()) {
        return reply
          .status(400)
          .send({
            error: { code: "BAD_REQUEST", message: "userQuestion is required" },
          });
      }
      if (body.projectId && body.projectId !== options.projectId) {
        return reply
          .status(403)
          .send({
            error: {
              code: "PROJECT_FORBIDDEN",
              message: "Project is not loaded",
            },
          });
      }
      const manifestTools = (
        body.clientToolManifest as { tools?: FrontendToolDescriptorV1[] } | undefined
      )?.tools;
      try {
        assertRegisterableClientTools(manifestTools ?? []);
      } catch (error) {
        if (!(error instanceof UnsupportedToolTierError)) throw error;
        return reply.status(400).send({
          error: {
            code: "TOOL_TIER_UNSUPPORTED",
            message: error.message,
            retryable: false,
            details: { tools: error.tools },
          },
        });
      }
      const run = options.runManager.createRun(
        body as unknown as Parameters<RunManager["createRun"]>[0],
      );
      return { runId: run.id };
    },
  );
  app.get<{ Params: { sessionId: string } }>(
    "/v1/sessions/:sessionId/runs",
    async (request) => ({
      sessionId: request.params.sessionId,
      runs: options.runManager.activeRunsForSession(request.params.sessionId),
    }),
  );
  app.get<{ Params: { runId: string }; Querystring: { lastEventId?: string } }>(
    "/v1/runs/:runId/events",
    async (request, reply) => {
      if (!options.runManager.getRun(request.params.runId)) {
        // A run that aged out is a different problem from one that never
        // existed: the client should stop retrying, not re-create the run.
        const expired = options.runManager.isExpired(request.params.runId);
        return reply.status(expired ? 410 : 404).send({
          error: expired
            ? { code: "RUN_EXPIRED", message: "Run is no longer retained" }
            : { code: "RUN_NOT_FOUND", message: "Run not found" },
        });
      }
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.hijack();
      let unsubscribe: (() => void) | null = null;
      let heartbeat: NodeJS.Timeout | null = null;
      const onEvent = (
        event: Parameters<Parameters<RunManager["subscribe"]>[1]>[0],
      ) => {
        writeSse(reply, event, event.seq);
        if (event.type === "run_completed" || event.type === "run_error") {
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe?.();
          reply.raw.end();
        }
      };
      unsubscribe = options.runManager.subscribe(
        request.params.runId,
        onEvent,
        resumeCursor(
          request.headers["last-event-id"],
          request.query?.lastEventId,
        ),
      );
      if (!reply.raw.writableEnded) {
        heartbeat = setInterval(
          () => writeSse(reply, { type: "ping", at: Date.now() }),
          15_000,
        );
      }
      heartbeat?.unref();
      request.raw.on("close", () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
      });
    },
  );
  app.post<{ Params: { runId: string }; Body: HostToolResultRequest }>(
    "/v1/runs/:runId/host-results",
    async (request, reply) => {
      const ok = options.runManager.completeHostAction(
        request.params.runId,
        request.body,
      );
      return ok
        ? { ok: true }
        : reply.status(404).send({ error: { code: "HOST_ACTION_NOT_FOUND" } });
    },
  );
  app.delete<{ Params: { runId: string } }>(
    "/v1/runs/:runId",
    async (request, reply) => {
      return options.runManager.cancelRun(request.params.runId)
        ? { ok: true }
        : reply.status(404).send({ error: { code: "RUN_NOT_FOUND" } });
    },
  );
  return app;
}
