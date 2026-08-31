import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  END,
  START,
  StateGraph,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import {
  createAgent,
  toolCallLimitMiddleware,
  toolRetryMiddleware,
} from "langchain";
import type { FrontendToolDescriptorV1 } from "@inupedia/spotlight-protocol";
import type {
  IntentDecision,
  RunContext,
  SpotlightToolCallInfo,
  WorkflowLane,
} from "../contracts.js";
import {
  actionToolAllowlist,
  isPersonalMemoryInspection,
  isMemoryReadEnabled,
  memoryControlMode,
} from "../safety.js";
import {
  actionToolsAllowedBySkills,
  buildCapabilityHelp,
  isCapabilityHelpQuestion,
  prepareRunSkills,
} from "../skills.js";
import {
  canonicalSkillName,
  createAgentSkillsRuntime,
} from "../deepAgentSkills.js";
import {
  createClientLangChainTool,
  createLongTermMemoryTools,
  createServerLangChainTool,
  memoryNamespace,
  normalizeClientToolInput,
} from "../tools.js";
import { emitPhase, emitTool } from "./emit.js";
import {
  conversationMemoryMiddleware,
  observationMiddleware,
} from "./agentMiddleware.js";
import {
  observedStateForRouter,
  observedStatePromptBlock,
} from "./observedState.js";
import {
  buildRouterContextPayload,
  buildSessionContext,
  sessionContextPromptBlock,
} from "./sessionContext.js";
import {
  emptyEvidenceBundle,
  evidenceFromSource,
  mergeEvidenceBundles,
} from "./evidence.js";
import {
  actionReplyFromToolOutput,
  evidenceProgressSummary,
  routeProgressSummary,
  toolErrorMessage,
  toolInputSummary,
  toolOutputSummary,
  toolsForMatchedSkills,
} from "./helpers.js";
import { matchedSkillDeclaresChain } from "./skillChain.js";
import { buildLongTermMemoryContext } from "./longTermMemory.js";
import {
  assistantUpdate,
  compactText,
  finalAgentText,
  RuntimeState,
} from "./state.js";
import {
  buildKnowledgeSynthesizeMessages,
  fallbackReplyFromEvidence,
} from "./synthesize.js";
import type { SpotlightGraphOptions } from "./types.js";
import { resolveGatherSources } from "../knowledgeSource.js";
import { streamVoiceBriefing } from "./voiceBriefing.js";

function knowledgeToolCall(
  name: string,
  displayName: string,
  input: Record<string, unknown>,
): SpotlightToolCallInfo {
  return {
    id: crypto.randomUUID(),
    name,
    input,
    displayName,
  };
}

async function invokeProviderSearch(
  config: LangGraphRunnableConfig | undefined,
  options: SpotlightGraphOptions,
  context: RunContext,
  source: string,
  toolName: string,
  displayName: string,
  search: (
    query: string,
  ) => Promise<import("../contracts.js").KnowledgeEvidence[]>,
  query: string,
) {
  const call = knowledgeToolCall(toolName, displayName, { query });
  emitTool(config, options, { type: "tool_start", call });
  emitPhase(
    config,
    options,
    "knowledge_agent_start",
    source === "联网搜索"
      ? `正在使用${source}搜索：“${compactText(query, 64)}”。`
      : `正在检索${source}：“${compactText(query, 64)}”。`,
  );
  try {
    const items = await search(query);
    const summary = evidenceProgressSummary(source, query, items);
    emitTool(config, options, {
      type: "tool_result",
      result: { call, success: true, summary, output: items },
    });
    emitPhase(
      config,
      options,
      "knowledge_agent_start",
      `${summary}\n正在依据资料组织回答。`,
    );
    return evidenceFromSource({
      source,
      items,
      summary,
      attempted: true,
      completed: true,
    });
  } catch (error) {
    emitTool(config, options, {
      type: "tool_result",
      result: {
        call,
        success: false,
        summary: `${source}检索失败。`,
        error: toolErrorMessage(error),
      },
    });
    return evidenceFromSource({
      source,
      summary: `${source}已尝试调用，但未取得可用结果。`,
      attempted: true,
      failed: true,
    });
  }
}

function gatherSourceFlags(
  context: RunContext,
  state: { question: string; lane?: WorkflowLane; decision?: IntentDecision },
  serverReadCount: number,
) {
  return resolveGatherSources({
    question: state.question,
    lane: state.lane ?? "knowledge",
    knowledgeSource: state.decision?.knowledgeSource,
    hasKnowledge: Boolean(context.project.knowledgeProvider),
    hasWeb: Boolean(context.project.webSearchProvider),
    hasServer: serverReadCount > 0,
  });
}

function buildGatherSubgraph(
  context: RunContext,
  options: SpotlightGraphOptions,
  runSkills: ReturnType<typeof prepareRunSkills>,
) {
  const serverReads = context.project.serverTools.filter(
    (item) => item.metadata.effect === "read",
  );
  return new StateGraph(RuntimeState)
    .addNode("gather_enter", async (state, config) => {
      const knowledgeSkill = runSkills.find(
        (skill) => skill.name === "skill.knowledge",
      );
      const sources = gatherSourceFlags(context, state, serverReads.length);
      const availableSources = [
        sources.knowledge ? "知识库" : null,
        sources.web ? "联网搜索" : null,
        ...serverReads.map((item) => `服务端工具“${item.name}”`),
      ].filter((item): item is string => Boolean(item));
      emitPhase(
        config,
        options,
        "knowledge_agent_start",
        availableSources.length > 0
          ? `${knowledgeSkill ? `使用 Skill：${knowledgeSkill.displayName ?? knowledgeSkill.name}（${knowledgeSkill.name}）；` : ""}可用资料源：${availableSources.join("、")}；正在查找“${compactText(state.question, 48)}”的依据。`
          : "当前没有配置外部资料源，将仅依据项目上下文回答。",
      );
      return {};
    })
    .addNode("provider_knowledge", async (state, config) => {
      const provider = context.project.knowledgeProvider;
      if (
        !provider ||
        !gatherSourceFlags(context, state, serverReads.length).knowledge
      ) {
        return { evidenceBundle: emptyEvidenceBundle() };
      }
      return {
        evidenceBundle: await invokeProviderSearch(
          config,
          options,
          context,
          "知识库",
          "project_knowledge_search",
          "检索项目知识库",
          (query) =>
            provider.search({
              query,
              projectId: context.project.projectId,
              sessionId: context.request.sessionId ?? context.runId,
              signal: context.signal,
              onToolEvent: (event) => {
                if (event.type === "start") {
                  emitTool(config, options, {
                    type: "tool_start",
                    call: event.call,
                  });
                  return;
                }
                if (event.type === "progress") {
                  emitTool(config, options, {
                    type: "tool_progress",
                    call: event.call,
                    summary: event.summary,
                  });
                  return;
                }
                emitTool(config, options, {
                  type: "tool_result",
                  result: {
                    call: event.call,
                    success: event.success,
                    summary: event.summary,
                    output: event.output,
                    error: event.error,
                  },
                });
              },
            }),
          state.question,
        ),
      };
    })
    .addNode("provider_web", async (state, config) => {
      const provider = context.project.webSearchProvider;
      if (
        !provider ||
        !gatherSourceFlags(context, state, serverReads.length).web
      ) {
        return { evidenceBundle: emptyEvidenceBundle() };
      }
      return {
        evidenceBundle: await invokeProviderSearch(
          config,
          options,
          context,
          "联网搜索",
          "web_search",
          "联网搜索",
          (query) =>
            provider.search({
              query,
              projectId: context.project.projectId,
              sessionId: context.request.sessionId ?? context.runId,
              signal: context.signal,
            }),
          state.question,
        ),
      };
    })
    .addNode("provider_server", async (state, config) => {
      if (serverReads.length === 0) {
        return { evidenceBundle: emptyEvidenceBundle() };
      }
      let bundle = emptyEvidenceBundle();
      for (const item of serverReads) {
        const source = `服务端工具“${item.name}”`;
        const call = knowledgeToolCall(
          item.name,
          item.description || item.name,
          { query: state.question },
        );
        const tool = createServerLangChainTool(item, context);
        emitTool(config, options, { type: "tool_start", call });
        try {
          const output = await (tool as StructuredToolInterface).invoke({
            query: state.question,
          });
          const summary = `${source}已完成（${toolInputSummary({ query: state.question })}，${toolOutputSummary(output)}）。`;
          emitTool(config, options, {
            type: "tool_result",
            result: { call, success: true, summary, output },
          });
          bundle = mergeEvidenceBundles(
            bundle,
            evidenceFromSource({
              source,
              items: [
                {
                  content:
                    typeof output === "string"
                      ? output
                      : JSON.stringify(output),
                  title: item.name,
                },
              ],
              summary,
              attempted: true,
              completed: true,
            }),
          );
        } catch (error) {
          emitTool(config, options, {
            type: "tool_result",
            result: {
              call,
              success: false,
              summary: `${source}调用失败。`,
              error: toolErrorMessage(error),
            },
          });
          bundle = mergeEvidenceBundles(
            bundle,
            evidenceFromSource({
              source,
              summary: `${source}已尝试调用，但未取得可用结果。`,
              attempted: true,
              failed: true,
            }),
          );
        }
      }
      return { evidenceBundle: bundle };
    })
    .addNode("gather_join", async () => ({}))
    .addEdge(START, "gather_enter")
    .addEdge("gather_enter", "provider_knowledge")
    .addEdge("gather_enter", "provider_web")
    .addEdge("gather_enter", "provider_server")
    .addEdge("provider_knowledge", "gather_join")
    .addEdge("provider_web", "gather_join")
    .addEdge("provider_server", "gather_join")
    .addEdge("gather_join", END)
    .compile();
}

export function compileSpotlightWorkflow(
  context: RunContext,
  options: SpotlightGraphOptions,
) {
  const clientTools = context.request.clientToolManifest?.tools ?? [];
  const runSkills = prepareRunSkills(context.request.skills, clientTools);
  const skillBoundClientTools = actionToolsAllowedBySkills(
    clientTools,
    runSkills,
  );
  const memorySubjectId = context.request.memorySubjectId?.trim();
  const namespace = memorySubjectId
    ? memoryNamespace(context.project.projectId, memorySubjectId)
    : null;
  const gather = buildGatherSubgraph(context, options, runSkills);
  const sessionContext = buildSessionContext(context.request);
  const sessionPrompt = sessionContextPromptBlock(sessionContext);
  // Read late, never captured: the runtime replaces this after every host call.
  const observation = () => context.observed?.() ?? context.request.uiContext;
  const observedPrompt = () => observedStatePromptBlock(observation());

  return new StateGraph(RuntimeState)
    .addNode("route", async (state, config) => {
      if (memoryControlMode(state.question)) {
        const decision: IntentDecision = {
          route: "knowledge",
          confidence: 1,
          reason: "Deterministic memory-control intent fence.",
          requestedToolNames: [],
          explicitActionEvidence: null,
          matchedSkillNames: [],
        };
        emitPhase(
          config,
          options,
          "router_done",
          `识别为记忆管理：“${compactText(state.question)}”；只处理用户明确要求的记住或忘记操作。`,
        );
        return { decision, lane: "memory_mutate" as WorkflowLane };
      }
      if (isPersonalMemoryInspection(state.question)) {
        const decision: IntentDecision = {
          route: "knowledge",
          confidence: 1,
          reason: "Deterministic personal-memory inspection fence.",
          requestedToolNames: [],
          explicitActionEvidence: null,
          matchedSkillNames: [],
        };
        emitPhase(
          config,
          options,
          "router_done",
          `识别为个人记忆查询：“${compactText(state.question)}”；只读取用户授权的长期记忆，不调用知识库、联网搜索或页面 Tool。`,
        );
        return {
          decision,
          lane: "knowledge" as WorkflowLane,
          skipGather: true,
          skipMemoryRecall: false,
        };
      }
      const decision = await options.router.route(
        state.question,
        clientTools,
        runSkills,
        buildRouterContextPayload(
          sessionContext,
          observedStateForRouter(observation()),
        ),
      );
      options.onDecision?.(decision);
      const chain = matchedSkillDeclaresChain(
        runSkills,
        decision.matchedSkillNames,
        clientTools,
      );
      let lane: WorkflowLane = decision.route;
      if (chain) {
        lane = "knowledge_then_action";
        decision.knowledgeSource = "knowledge";
      }
      const allowed = actionToolAllowlist(
        toolsForMatchedSkills(skillBoundClientTools, runSkills, decision),
        decision,
      );
      if (lane === "action" && allowed.length === 0) {
        const clarifiedDecision = {
          ...decision,
          route: "clarify" as const,
          reason:
            "No registered client tool safely matches the requested action.",
        };
        emitPhase(
          config,
          options,
          "router_done",
          `${routeProgressSummary(state.question, clarifiedDecision)} 当前没有已注册且可安全匹配的页面工具。`,
        );
        return { decision: clarifiedDecision, lane: "clarify" as WorkflowLane };
      }
      if (isCapabilityHelpQuestion(state.question, context.project.uiPrompts)) {
        emitPhase(
          config,
          options,
          "router_done",
          routeProgressSummary(state.question, {
            ...decision,
            route: "knowledge",
          }),
        );
        return {
          decision: { ...decision, route: "knowledge" as const },
          lane: "knowledge" as WorkflowLane,
          skipGather: true,
          skipMemoryRecall: true,
        };
      }
      emitPhase(
        config,
        options,
        "router_done",
        routeProgressSummary(
          state.question,
          lane === "knowledge_then_action"
            ? { ...decision, route: "action" }
            : decision,
        ),
      );
      return { decision, lane, skipGather: false };
    })
    .addNode("memory_recall", async (_state, config) => {
      if (!namespace || !isMemoryReadEnabled(context.request)) {
        return { memoryContext: "" };
      }
      const storedMemories = await options.store.search(namespace, { limit: 20 });
      const recalled = buildLongTermMemoryContext(storedMemories);
      if (recalled.ids.length > 0) {
        emitPhase(
          config,
          options,
          "memory_recall",
          `使用长期记忆：${recalled.labels.join("、")}；这些内容只作为用户授权的上下文，不替代本轮路由、资料检索或 Tool 参数。`,
        );
      }
      return {
        memoryContext: recalled.prompt,
      };
    })
    .addNode("knowledge_gather", gather)
    .addNode("knowledge_synthesize", async (state, config) => {
      if (isCapabilityHelpQuestion(state.question, context.project.uiPrompts)) {
        const reply = buildCapabilityHelp(
          runSkills,
          clientTools,
          context.project.uiPrompts,
        );
        emitPhase(
          config,
          options,
          "knowledge_agent_done",
          `已根据本次注册的 ${runSkills.length} 个 Skill 和 ${clientTools.length} 个页面 Tool 生成能力说明。`,
        );
        return { ...assistantUpdate(reply), invokedClientTools: [] };
      }
      const memoryReadEnabled = isMemoryReadEnabled(context.request);
      if (
        isPersonalMemoryInspection(state.question) &&
        !state.memoryContext.trim()
      ) {
        const reply = !namespace
          ? "当前没有可识别的稳定用户身份，因此无法读取跨会话长期记忆。"
          : !memoryReadEnabled
            ? "本轮已关闭长期记忆读取，因此我没有读取您的个人记忆。"
            : "我没有找到您明确授权保存的长期记忆。";
        emitPhase(
          config,
          options,
          "knowledge_agent_done",
          "个人长期记忆中没有可用于回答的内容；未调用模型、知识库、联网搜索或页面 Tool。",
        );
        return { ...assistantUpdate(reply), invokedClientTools: [] };
      }
      const evidence = state.evidenceBundle ?? emptyEvidenceBundle();
      const result = await options.model.invoke(
        buildKnowledgeSynthesizeMessages({
          question: state.question,
          evidence,
          sessionPrompt,
          projectPrompt: context.project.systemPrompt ?? "",
          memoryContext: memoryReadEnabled
            ? state.memoryContext
            : "The user disabled memory recall for this turn. Do not use long-term memory.",
          observedPrompt: observedPrompt(),
          messages: state.messages,
        }),
        config,
      );
      const reply =
        finalAgentText(result) || fallbackReplyFromEvidence(evidence);
      const usedKnowledgeSkills = runSkills.filter((skill) =>
        state.decision.matchedSkillNames?.includes(skill.name),
      );
      const incompleteSearches = evidence.attemptedSources
        .filter((source) => !evidence.completedSources.includes(source))
        .map((source) => `${source}已尝试调用，但未取得可用结果。`);
      const activitySummary = [
        ...new Set([...evidence.sourceSummaries, ...incompleteSearches]),
      ];
      emitPhase(
        config,
        options,
        "knowledge_agent_done",
        `${usedKnowledgeSkills.length > 0 ? `使用 Skill：${usedKnowledgeSkills.map((skill) => `${skill.displayName ?? skill.name}（${skill.name}）`).join("、")}；` : ""}${
          activitySummary.length > 0
            ? activitySummary.join("\n")
            : evidence.attemptedSources.length > 0
              ? "已尝试调用外部资料源，但没有取得可用结果；回答仅依据模型与当前项目上下文生成。"
              : "本轮未调用项目知识库、联网搜索或服务端资料工具；回答仅依据模型与当前项目上下文生成。"
        }`,
      );
      return { ...assistantUpdate(reply), invokedClientTools: [] };
    })
    .addNode("decide", async (state, config) => {
      const sufficiency = state.evidenceBundle?.sufficiency ?? "none";
      if (sufficiency !== "enough") {
        emitPhase(
          config,
          options,
          "knowledge_agent_done",
          "证据不足，不能进入页面操作。",
        );
        return { lane: "clarify" as WorkflowLane };
      }
      return { lane: "action" as WorkflowLane };
    })
    .addNode("action_plan", async (state, config) => {
      const initiallyMatchedSkills = runSkills.filter((skill) =>
        state.decision.matchedSkillNames?.includes(skill.name),
      );
      const scopedTools = toolsForMatchedSkills(
        skillBoundClientTools,
        runSkills,
        state.decision,
      );
      const allowed = actionToolAllowlist(scopedTools, {
        ...state.decision,
        route: "action",
      });
      const selectedTool = state.decision.requestedToolNames[0];
      const planSummary =
        selectedTool && allowed.some((tool) => tool.name === selectedTool)
          ? `${initiallyMatchedSkills.length > 0 ? `使用 Skill：${initiallyMatchedSkills.map((skill) => `${skill.displayName ?? skill.name}（${skill.name}）`).join("、")}；` : ""}已选定工具：${selectedTool}。`
          : `${initiallyMatchedSkills.length > 0 ? `使用 Skill：${initiallyMatchedSkills.map((skill) => `${skill.displayName ?? skill.name}（${skill.name}）`).join("、")}；` : ""}正在从 ${allowed.length} 个已注册页面工具中匹配“${compactText(state.question, 56)}”。`;
      emitPhase(config, options, "action_agent_start", planSummary);
      return {};
    })
    .addNode("action_execute", async (state, config) => {
      const invoked: string[] = [];
      const initiallyMatchedSkills = runSkills.filter((skill) =>
        state.decision.matchedSkillNames?.includes(skill.name),
      );
      const scopedTools = toolsForMatchedSkills(
        skillBoundClientTools,
        runSkills,
        state.decision,
      );
      const allowed = actionToolAllowlist(scopedTools, {
        ...state.decision,
        route: "action",
      });
      const selectedToolName = state.decision.requestedToolNames[0];
      const routerSelectedTool =
        (state.decision.matchedSkillNames?.length ?? 0) > 0 &&
        selectedToolName &&
        allowed.find((tool) => tool.name === selectedToolName);

      if (routerSelectedTool) {
        const descriptor = routerSelectedTool;
        const input = normalizeClientToolInput(
          descriptor,
          state.decision.requestedToolInput ?? {},
        );
        const required = Array.isArray(descriptor.inputSchema?.required)
          ? descriptor.inputSchema.required
          : [];
        const hasRequiredInput =
          required.length === 0 ||
          required.every(
            (field) =>
              input[field] !== undefined && String(input[field]).trim() !== "",
          );
        if (hasRequiredInput) {
          const tool = createClientLangChainTool(descriptor, context, invoked, {
            onStart: (call) =>
              emitTool(config, options, { type: "tool_start", call }),
            onComplete: (call, result) =>
              emitTool(config, options, {
                type: "tool_result",
                result: {
                  call,
                  success: result.success,
                  summary: result.success
                    ? `已完成：${call.displayName}`
                    : result.error || `${call.displayName}失败。`,
                  output: result.output,
                  error: result.error,
                  trace: result.trace,
                },
              }),
          }) as StructuredToolInterface;
          const output = await tool.invoke(input);
          return {
            ...assistantUpdate(actionReplyFromToolOutput(descriptor, output)),
            invokedClientTools: invoked,
          };
        }
      }

      if (
        (state.decision.matchedSkillNames?.length ?? 0) > 0 &&
        allowed.length === 0
      ) {
        return {
          ...assistantUpdate(
            "我还不能安全地确定要调用哪个页面工具。请补充具体目标，例如建筑物名称、监控点位或要打开的页面。",
          ),
          invokedClientTools: [],
        };
      }

      const matchedSkillPaths = initiallyMatchedSkills.map(
        (skill) => `/skills/${canonicalSkillName(skill.name)}/SKILL.md`,
      );
      const tools = allowed.map((item) =>
        createClientLangChainTool(item, context, invoked, {
          onStart: (call) =>
            emitTool(config, options, { type: "tool_start", call }),
          onComplete: (call, result) =>
            emitTool(config, options, {
              type: "tool_result",
              result: {
                call,
                success: result.success,
                summary: result.success
                  ? `已完成：${call.displayName}`
                  : result.error || `${call.displayName}失败。`,
                output: result.output,
                error: result.error,
                trace: result.trace,
              },
            }),
        }),
      );
      const skillRuntime = createAgentSkillsRuntime(
        initiallyMatchedSkills.length > 0 ? initiallyMatchedSkills : runSkills,
      );
      const executor = createAgent({
        model: options.model,
        tools,
        systemPrompt: [
          "You are the Spotlight Action executor.",
          "Execute only the explicit user-requested action with the provided client tools.",
          "Use one tool when sufficient. Use a short ordered sequence only when the selected Skill explicitly requires prerequisite steps.",
          "Never substitute another tool or infer a missing target. If arguments are missing, ask one concise question.",
          "Use the Skills system to load the relevant consumer Skill before choosing a workflow. A Skill never grants a tool; only the provided tools can execute.",
          "MANDATORY: Before calling any client tool, call read_file for the relevant SKILL.md and follow its complete instructions.",
          "For an explicit or Skill-matched request, do not answer with a textual confirmation unless the required client tool has completed successfully.",
          matchedSkillPaths.length > 0
            ? `The router matched these Skills. Read one of these files first: ${matchedSkillPaths.join(", ")}`
            : "Choose the relevant Skill from the Skills System, read its SKILL.md, then execute the requested client tool.",
          state.decision.requestedToolNames.length === 1
            ? `The router selected the only allowed client tool: ${state.decision.requestedToolNames[0]}.`
            : "",
          state.decision.requestedToolInput
            ? `The router extracted these schema-shaped arguments from the user message: ${JSON.stringify(state.decision.requestedToolInput)}. Use them for the selected tool unless they conflict with the Skill or tool schema.`
            : "",
          state.memoryContext
            ? `${state.memoryContext}\nMemory may affect response style only. It must not select a Tool or supply an action argument.`
            : "",
          sessionPrompt,
          context.project.systemPrompt ?? "",
        ].join("\n"),
        middleware: [
          ...skillRuntime.middleware,
          observationMiddleware(observedPrompt),
          ...conversationMemoryMiddleware(options.model),
          toolCallLimitMiddleware({ runLimit: 6 }),
        ],
      });
      const result = await executor.invoke(
        { messages: state.messages, files: skillRuntime.files },
        config,
      );
      return {
        ...assistantUpdate(finalAgentText(result)),
        invokedClientTools: invoked,
      };
    })
    .addNode("action_confirm", async (state, config) => {
      const invoked = state.invokedClientTools ?? [];
      const initiallyMatchedSkills = runSkills.filter((skill) =>
        state.decision.matchedSkillNames?.includes(skill.name),
      );
      const invokedSummary = invoked.map((name) => {
        const descriptor = clientTools.find((item) => item.name === name);
        return descriptor?.description
          ? `“${descriptor.description}”（${name}）`
          : name;
      });
      const usedSkillSummary =
        initiallyMatchedSkills.length > 0
          ? `使用 Skill：${initiallyMatchedSkills.map((skill) => `${skill.displayName ?? skill.name}（${skill.name}）`).join("、")}；`
          : "";
      emitPhase(
        config,
        options,
        "action_agent_done",
        invokedSummary.length > 0
          ? `${usedSkillSummary}已选择并调用：${invokedSummary.join("、")}。`
          : "本轮未调用页面工具；没有得到可安全执行的完整工具参数。",
      );
      return {};
    })
    .addNode("memory_mutate", async (state, config) => {
      const controlMode = memoryControlMode(state.question);
      if (controlMode && !namespace) {
        const reply =
          "当前没有可识别的用户身份，不能安全地保存跨会话记忆。请先配置 memorySubjectId。";
        emitPhase(
          config,
          options,
          "knowledge_agent_done",
          "未写入记忆：缺少稳定用户身份。",
        );
        return { ...assistantUpdate(reply), invokedClientTools: [] };
      }
      const existingMemory =
        controlMode && namespace
          ? buildLongTermMemoryContext(
              await options.store.search(namespace, { limit: 50 }),
              { maxItems: 50, maxContextChars: 8_000 },
            )
          : { ids: [], labels: [], prompt: "" };
      const tools =
        controlMode && namespace
          ? createLongTermMemoryTools(options.store, namespace, controlMode, {
              onStart: (call) =>
                emitTool(config, options, { type: "tool_start", call }),
              onComplete: (call, result) =>
                emitTool(config, options, {
                  type: "tool_result",
                  result: {
                    call,
                    success: result.success,
                    summary: result.success
                      ? String(result.output ?? `${call.displayName}已完成。`)
                      : result.error || `${call.displayName}失败。`,
                    output: result.output,
                    error: result.error,
                  },
                }),
            })
          : [];
      const agent = createAgent({
        model: options.model,
        tools,
        systemPrompt: [
          "You are the Spotlight memory controller.",
          "Only perform the explicit remember or forget operation.",
          controlMode === "remember"
            ? "The user explicitly requested a remember operation. Save one concise stable key and the exact preference or stable fact. Reuse an existing key when it represents the same concept. You must call the provided memory tool before confirming success."
            : controlMode === "forget"
              ? "The user explicitly requested a forget operation. Delete only an exact existing key that uniquely matches the request. If no key or multiple keys match, ask one concise clarification and do not call a tool."
              : "No memory mutation is allowed.",
          existingMemory.prompt
            ? `Existing user-approved memories:\n${existingMemory.prompt}`
            : "There are no existing long-term-memory keys for this subject.",
        ].join("\n"),
        middleware: [
          toolRetryMiddleware({ maxRetries: 2 }),
          toolCallLimitMiddleware({ runLimit: 2 }),
        ],
      });
      const result = await agent.invoke({ messages: state.messages }, config);
      const reply = finalAgentText(result);
      emitPhase(
        config,
        options,
        "knowledge_agent_done",
        "已处理用户的记忆请求。",
      );
      return { ...assistantUpdate(reply), invokedClientTools: [] };
    })
    .addNode("clarify", async () => {
      const reply =
        context.project.clarificationPrompt ??
        "我还不能安全地确定你要执行的操作或目标，请明确说要打开、关闭、播放或切换什么。";
      return { ...assistantUpdate(reply), invokedClientTools: [] };
    })
    .addNode("voice_briefing", async (state, config) => {
      if (context.request.interactionMode !== "voice") {
        return { voiceBriefing: [] };
      }
      const answer = state.assistantReply?.trim();
      if (!answer) return { voiceBriefing: [] };
      emitPhase(
        config,
        options,
        "voice_briefing_start",
        "正在把完整回答压缩成适合数字人口播的短句。",
      );
      const sentences = await streamVoiceBriefing({
        model: options.model,
        question: state.question,
        answer,
        config,
        onSentence: options.onVoiceSentence,
      });
      emitPhase(
        config,
        options,
        "voice_briefing_done",
        sentences.length > 0
          ? `已生成 ${sentences.length} 句口播内容。`
          : "没有生成可播报的口播内容，保留完整文字回答。",
      );
      return { voiceBriefing: sentences };
    })
    .addEdge(START, "route")
    .addConditionalEdges("route", (state) => {
      if (state.lane === "memory_mutate") return "memory_mutate";
      if (state.lane === "clarify") return "clarify";
      if (state.skipGather && state.skipMemoryRecall) {
        return "knowledge_synthesize";
      }
      return "memory_recall";
    })
    .addConditionalEdges("memory_recall", (state) => {
      if (state.skipGather) return "knowledge_synthesize";
      if (state.lane === "action") return "action_plan";
      if (state.lane === "knowledge_then_action") {
        return "knowledge_gather";
      }
      return "knowledge_gather";
    })
    .addConditionalEdges("knowledge_gather", (state) =>
      state.lane === "knowledge_then_action"
        ? "decide"
        : "knowledge_synthesize",
    )
    .addConditionalEdges("decide", (state) =>
      state.lane === "action" ? "action_plan" : "clarify",
    )
    .addEdge("knowledge_synthesize", "voice_briefing")
    .addEdge("action_plan", "action_execute")
    .addEdge("action_execute", "action_confirm")
    .addEdge("action_confirm", "voice_briefing")
    .addEdge("memory_mutate", "voice_briefing")
    .addEdge("clarify", "voice_briefing")
    .addEdge("voice_briefing", END)
    .compile({ checkpointer: options.checkpointer, store: options.store });
}
