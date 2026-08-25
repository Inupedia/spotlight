import {
  deriveToolTier,
  isToolTierReplaySafe,
  SPOTLIGHT_CAPABILITY_PROTOCOL_V1,
  type FrontendToolDescriptorV1,
  type FrontendToolManifestV1,
  type JsonSchemaV1,
  type ToolReplayPolicyV1,
  type ToolRiskLevelV1,
  type ToolSideEffectV1,
  type ToolTierV1,
} from "@inupedia/spotlight-protocol";

export const CLIENT_TOOL_META = Symbol.for("inupedia.spotlight.client-tool");

export interface ClientToolSchemaOverride {
  input: JsonSchemaV1;
  output?: JsonSchemaV1;
}

export interface ClientToolOptions {
  /** Escape hatch for types the build plugin cannot safely infer. */
  schema?: ClientToolSchemaOverride;
  version?: string;
  /**
   * What the runtime must guarantee before dispatching this tool. Declare it
   * directly; the legacy fields below only exist to keep older call sites
   * working and are derived from each other when `tier` is omitted.
   */
  tier?: ToolTierV1;
  sideEffect?: ToolSideEffectV1;
  replayPolicy?: ToolReplayPolicyV1;
  riskLevel?: ToolRiskLevelV1;
  requiresConfirmation?: boolean;
  maxOutputBytes?: number;
}

export interface GeneratedClientToolMeta extends ClientToolOptions {
  name: string;
  description: string;
  schema: ClientToolSchemaOverride;
}

export type ClientToolHandler<TInput, TOutput> = (
  input: TInput,
) => TOutput | Promise<TOutput>;

export type ClientTool<TInput = never, TOutput = unknown> =
  ClientToolHandler<TInput, TOutput> & {
    readonly [CLIENT_TOOL_META]: GeneratedClientToolMeta;
  };

function isGeneratedMeta(
  value: ClientToolOptions | GeneratedClientToolMeta | undefined,
): value is GeneratedClientToolMeta {
  return Boolean(
    value &&
      "name" in value &&
      typeof value.name === "string" &&
      "description" in value &&
      typeof value.description === "string" &&
      value.schema?.input,
  );
}

/**
 * Define a browser-side tool. Name, JSDoc and schemas are injected by the
 * Spotlight Vite plugin. Pass `schema` only as an explicit inference escape hatch.
 */
export function defineClientTool<TInput = void, TOutput = void>(
  handler: ClientToolHandler<TInput, TOutput>,
  options?: ClientToolOptions | GeneratedClientToolMeta,
): ClientTool<TInput, TOutput> {
  if (!isGeneratedMeta(options)) {
    throw new Error(
      "defineClientTool() requires build metadata. Add spotlightClientTools() to Vite plugins, or provide code transformed by that plugin.",
    );
  }
  Object.defineProperty(handler, CLIENT_TOOL_META, {
    configurable: false,
    enumerable: false,
    value: Object.freeze(options),
    writable: false,
  });
  return handler as ClientTool<TInput, TOutput>;
}

export function getClientToolDescriptor(
  tool: ClientTool,
): FrontendToolDescriptorV1 {
  const meta = tool[CLIENT_TOOL_META];
  const legacy = {
    sideEffect: meta.sideEffect ?? "ui",
    replayPolicy: meta.replayPolicy ?? "never",
    riskLevel: meta.riskLevel ?? "low",
    requiresConfirmation: meta.requiresConfirmation ?? false,
  } as const;
  return {
    name: meta.name,
    version: meta.version ?? "1.0.0",
    description: meta.description,
    inputSchema: meta.schema.input,
    outputSchema: meta.schema.output,
    maxOutputBytes: meta.maxOutputBytes,
    tier: deriveToolTier({ tier: meta.tier, ...legacy }),
    ...legacy,
  };
}

export function createClientToolRegistry(tools: readonly ClientTool[]) {
  const byName = new Map<string, ClientTool>();
  const unsupported: string[] = [];
  for (const tool of tools) {
    const descriptor = getClientToolDescriptor(tool);
    if (byName.has(descriptor.name)) {
      throw new Error(`Duplicate client tool: ${descriptor.name}`);
    }
    // Every dispatch path recovers by re-running the call, so a tool that
    // cannot be re-run safely must not reach the runtime at all.
    if (
      !isToolTierReplaySafe(descriptor.tier ?? "navigate") &&
      descriptor.requiresConfirmation !== true
    ) {
      unsupported.push(descriptor.name);
    }
    byName.set(descriptor.name, tool);
  }
  if (unsupported.length > 0) {
    throw new Error(
      `Client tools at the "mutate" tier must set requiresConfirmation: true: ${unsupported.join(", ")}.`,
    );
  }
  return {
    descriptors: [...byName.values()].map(getClientToolDescriptor),
    has(name: string): boolean {
      return byName.has(name);
    },
    async execute(name: string, input: unknown): Promise<unknown> {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Client tool is not registered: ${name}`);
      return (tool as unknown as ClientToolHandler<unknown, unknown>)(input);
    },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = globalThis.crypto?.subtle
    ? await globalThis.crypto.subtle.digest("SHA-256", bytes)
    : sha256Fallback(bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

const SHA256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f,
  0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
  0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
  0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
  0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** Browser-safe SHA-256 for HTTP origins where Web Crypto is unavailable. */
function sha256Fallback(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0);

  const state: number[] = [...SHA256_INITIAL_STATE];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = paddedView.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10);
      words[index] =
        (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choose = (e! & f!) ^ (~e! & g!);
      const temporary1 =
        (h! + sum1 + choose + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>>
        0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  state.forEach((word, index) => digestView.setUint32(index * 4, word));
  return digest;
}

export async function createClientToolManifest(options: {
  projectId: string;
  frontendBuildId: string;
  tools: readonly ClientTool[];
}): Promise<FrontendToolManifestV1> {
  const registry = createClientToolRegistry(options.tools);
  const tools = [...registry.descriptors].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const unsigned = {
    protocolVersion: SPOTLIGHT_CAPABILITY_PROTOCOL_V1,
    projectId: options.projectId,
    frontendBuildId: options.frontendBuildId,
    tools,
  };
  return {
    ...unsigned,
    manifestDigest: await sha256(stableJson(unsigned)),
  };
}
