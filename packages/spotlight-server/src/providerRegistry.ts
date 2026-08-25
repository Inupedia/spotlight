import type {
  KnowledgeProvider,
  SpotlightServerTool,
  WebSearchProvider,
} from "./contracts.js";
import { HikariSearchProvider } from "./providers/hikari.js";
import { YuxiKnowledgeProvider } from "./providers/yuxi.js";

export type SpotlightProviderConfig = Record<string, unknown> & { type: string };
export type KnowledgeProviderFactory = (
  config: SpotlightProviderConfig,
) => KnowledgeProvider | Promise<KnowledgeProvider>;
export type WebSearchProviderFactory = (
  config: SpotlightProviderConfig,
) => WebSearchProvider | Promise<WebSearchProvider>;

/** Extensible provider control plane. Project modules register adapters, core does not hard-code them. */
export class SpotlightProviderRegistry {
  private readonly knowledge = new Map<string, KnowledgeProviderFactory>();
  private readonly web = new Map<string, WebSearchProviderFactory>();

  registerKnowledge(type: string, factory: KnowledgeProviderFactory): this {
    this.knowledge.set(type.trim().toLowerCase(), factory);
    return this;
  }

  registerWebSearch(type: string, factory: WebSearchProviderFactory): this {
    this.web.set(type.trim().toLowerCase(), factory);
    return this;
  }

  async createKnowledge(config?: SpotlightProviderConfig): Promise<KnowledgeProvider | undefined> {
    if (!config) return undefined;
    const factory = this.knowledge.get(config.type.trim().toLowerCase());
    if (!factory) throw new Error(`Unknown knowledge provider: ${config.type}`);
    return factory(config);
  }

  async createWebSearch(config?: SpotlightProviderConfig): Promise<WebSearchProvider | undefined> {
    if (!config) return undefined;
    const factory = this.web.get(config.type.trim().toLowerCase());
    if (!factory) throw new Error(`Unknown web search provider: ${config.type}`);
    return factory(config);
  }

  describe(): { knowledge: string[]; webSearch: string[] } {
    return {
      knowledge: [...this.knowledge.keys()].sort(),
      webSearch: [...this.web.keys()].sort(),
    };
  }
}

function text(config: SpotlightProviderConfig, key: string, required = false): string | undefined {
  const value = config[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required) throw new Error(`${config.type} provider requires ${key}`);
  return undefined;
}

export function createDefaultProviderRegistry(): SpotlightProviderRegistry {
  return new SpotlightProviderRegistry()
    .registerKnowledge("yuxi", (config) => new YuxiKnowledgeProvider({
      baseUrl: text(config, "baseUrl", true)!,
      apiKey: text(config, "apiKey"),
      username: text(config, "username"),
      password: text(config, "password"),
      agentSlug: text(config, "agentSlug"),
    }))
    .registerWebSearch("hikari", (config) => new HikariSearchProvider({
      baseUrl: text(config, "baseUrl", true)!,
      token: text(config, "token") ?? "",
      maxAttempts: typeof config.maxAttempts === "number" ? config.maxAttempts : undefined,
    }));
}

/** Duck-typed adapter for LangChain StructuredTool/DynamicStructuredTool. */
export function adaptLangChainTool(tool: {
  name: string;
  description: string;
  schema?: { toJSONSchema?: () => Record<string, unknown> };
  invoke(input: Record<string, unknown>): Promise<unknown>;
}, metadata: SpotlightServerTool["metadata"]): SpotlightServerTool {
  return {
    name: tool.name,
    description: tool.description,
    schema: tool.schema?.toJSONSchema?.() ?? { type: "object", additionalProperties: true },
    metadata,
    invoke: (input) => tool.invoke(input),
  };
}
