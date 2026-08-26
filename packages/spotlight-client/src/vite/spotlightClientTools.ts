import { parse } from "@babel/parser";
import traverseImport, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import MagicString from "magic-string";
import type { Plugin } from "vite";
import { createHash } from "node:crypto";

export interface SpotlightClientToolsOptions {
  include?: string | RegExp;
  projectId?: string;
  frontendBuildId?: string;
  manifestFileName?: string;
}

type JsonSchema = Record<string, unknown>;

const traverseAst = ((
  traverseImport as unknown as { default?: typeof traverseImport }
).default ?? traverseImport) as typeof traverseImport;

function literalSchema(node: t.TSLiteralType): JsonSchema {
  const value = node.literal;
  if (t.isStringLiteral(value)) return { type: "string", const: value.value };
  if (t.isNumericLiteral(value)) return { type: "number", const: value.value };
  if (t.isBooleanLiteral(value)) return { type: "boolean", const: value.value };
  throw new Error("unsupported literal type");
}

function schemaFromType(node: t.TSType): JsonSchema {
  if (t.isTSStringKeyword(node)) return { type: "string" };
  if (t.isTSNumberKeyword(node)) return { type: "number" };
  if (t.isTSBooleanKeyword(node)) return { type: "boolean" };
  if (t.isTSNullKeyword(node) || t.isTSVoidKeyword(node))
    return { type: "null" };
  if (t.isTSUnknownKeyword(node) || t.isTSAnyKeyword(node)) return {};
  if (t.isTSLiteralType(node)) return literalSchema(node);
  if (t.isTSArrayType(node)) {
    return { type: "array", items: schemaFromType(node.elementType) };
  }
  if (t.isTSUnionType(node)) {
    const variants = node.types.map(schemaFromType);
    const stringValues = variants
      .map((variant) => variant.const)
      .filter((value): value is string => typeof value === "string");
    if (stringValues.length === variants.length) {
      return { type: "string", enum: stringValues };
    }
    return { anyOf: variants };
  }
  if (t.isTSTypeLiteral(node)) {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const member of node.members) {
      if (!t.isTSPropertySignature(member) || !member.typeAnnotation) {
        throw new Error("only typed object properties are supported");
      }
      const key = t.isIdentifier(member.key)
        ? member.key.name
        : t.isStringLiteral(member.key)
          ? member.key.value
          : null;
      if (!key) throw new Error("computed property names are unsupported");
      properties[key] = schemaFromType(member.typeAnnotation.typeAnnotation);
      if (!member.optional) required.push(key);
    }
    return {
      type: "object",
      properties,
      additionalProperties: false,
      ...(required.length ? { required } : {}),
    };
  }
  throw new Error(`unsupported TypeScript type: ${node.type}`);
}

function handlerFunction(
  node:
    | t.Expression
    | t.SpreadElement
    | t.JSXNamespacedName
    | t.ArgumentPlaceholder,
) {
  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node))
    return node;
  return null;
}

function inputSchema(
  fn: t.ArrowFunctionExpression | t.FunctionExpression,
): JsonSchema {
  if (fn.params.length === 0) {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  if (
    fn.params.length !== 1 ||
    (!t.isIdentifier(fn.params[0]) && !t.isObjectPattern(fn.params[0]))
  ) {
    throw new Error("handler must have zero parameters or one typed parameter");
  }
  const paramAnnotation = fn.params[0].typeAnnotation;
  const annotation = t.isTSTypeAnnotation(paramAnnotation)
    ? paramAnnotation.typeAnnotation
    : undefined;
  if (!annotation)
    throw new Error("handler input parameter needs a TypeScript type");
  return schemaFromType(annotation);
}

function hasValueReturn(
  fn: t.ArrowFunctionExpression | t.FunctionExpression,
): boolean {
  if (!t.isBlockStatement(fn.body)) return true;
  let found = false;
  traverseAst(fn.body, {
    noScope: true,
    ReturnStatement(path) {
      if (path.node.argument) found = true;
    },
  });
  return found;
}

function outputSchema(
  fn: t.ArrowFunctionExpression | t.FunctionExpression,
): JsonSchema {
  const annotation = t.isTSTypeAnnotation(fn.returnType)
    ? fn.returnType.typeAnnotation
    : undefined;
  if (annotation) {
    if (
      t.isTSTypeReference(annotation) &&
      t.isIdentifier(annotation.typeName, { name: "Promise" }) &&
      annotation.typeParameters?.params.length === 1
    ) {
      return schemaFromType(annotation.typeParameters.params[0]);
    }
    return schemaFromType(annotation);
  }
  if (!hasValueReturn(fn)) return { type: "null" };
  throw new Error(
    "handler return type must be explicit when it returns a value",
  );
}

function jsDoc(path: NodePath<t.VariableDeclarator>): string {
  const declaration = path.parentPath?.node;
  const exportNode = path.parentPath?.parentPath?.node;
  const comments = [
    ...(declaration?.leadingComments ?? []),
    ...(exportNode?.leadingComments ?? []),
  ];
  const comment = comments
    .reverse()
    .find((item) => item.type === "CommentBlock");
  if (!comment) return "";
  return comment.value
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line && !line.startsWith("@"))
    .join(" ");
}

function staticJsonValue(
  node: t.Node,
  path: NodePath<t.VariableDeclarator>,
  seen = new Set<string>(),
): unknown {
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node)
  ) {
    return node.value;
  }
  if (t.isNullLiteral(node)) return null;
  if (t.isArrayExpression(node)) {
    return node.elements.map((element) => {
      if (!element || t.isSpreadElement(element)) {
        throw new Error("schema arrays cannot contain holes or spreads");
      }
      return staticJsonValue(element, path, seen);
    });
  }
  if (t.isObjectExpression(node)) {
    const result: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed) {
        throw new Error("schema objects cannot contain methods or spreads");
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null;
      if (!key) throw new Error("schema keys must be identifiers or strings");
      result[key] = staticJsonValue(property.value, path, seen);
    }
    return result;
  }
  if (t.isIdentifier(node)) {
    if (seen.has(node.name))
      throw new Error(`circular schema const: ${node.name}`);
    const binding = path.scope.getBinding(node.name);
    const declarator = binding?.path;
    if (!declarator?.isVariableDeclarator() || !declarator.node.init) {
      throw new Error(`schema identifier is not a local const: ${node.name}`);
    }
    const nextSeen = new Set(seen).add(node.name);
    return staticJsonValue(declarator.node.init, path, nextSeen);
  }
  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node)) {
    return staticJsonValue(node.expression, path, seen);
  }
  throw new Error(`schema contains dynamic expression: ${node.type}`);
}

function shouldInclude(id: string, include: string | RegExp): boolean {
  const clean = id.split("?", 1)[0];
  if (!/\.[cm]?[jt]sx?$/.test(clean) || clean.includes("node_modules"))
    return false;
  return typeof include === "string"
    ? clean.includes(include)
    : include.test(clean);
}

type ToolTier = "observe" | "query" | "navigate" | "mutate";

type BuildDescriptor = {
  name: string;
  namespace?: string;
  deferLoading?: boolean;
  version: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  tier?: ToolTier;
  sideEffect: "none" | "ui" | "external";
  replayPolicy: "safe" | "idempotency-key" | "never";
  riskLevel: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  maxOutputBytes?: number;
  resource?: {
    namespace: string;
    operation: "search" | "get" | "action";
    action?: string;
    inputKey?: string;
  };
};

function withTier(descriptor: BuildDescriptor): BuildDescriptor {
  return { ...descriptor, tier: buildTier(descriptor) };
}

/** Mirrors `deriveToolTier` in the protocol package, which cannot be imported here. */
function buildTier(descriptor: BuildDescriptor): ToolTier {
  if (descriptor.tier) return descriptor.tier;
  if (descriptor.sideEffect === "external") return "mutate";
  if (descriptor.riskLevel === "high" || descriptor.requiresConfirmation) {
    return "mutate";
  }
  if (descriptor.sideEffect === "none") {
    return descriptor.replayPolicy === "safe" ? "query" : "navigate";
  }
  return "navigate";
}

function staticToolOptions(
  options: t.ObjectExpression | undefined,
  path: NodePath<t.VariableDeclarator>,
): Partial<BuildDescriptor> {
  if (!options) return {};
  const allowed = new Set([
    "version",
    "tier",
    "sideEffect",
    "replayPolicy",
    "riskLevel",
    "requiresConfirmation",
    "maxOutputBytes",
  ]);
  const values: Record<string, unknown> = {};
  for (const property of options.properties) {
    if (!t.isObjectProperty(property) || property.computed) continue;
    const key = t.isIdentifier(property.key)
      ? property.key.name
      : t.isStringLiteral(property.key)
        ? property.key.value
        : "";
    if (allowed.has(key)) values[key] = staticJsonValue(property.value, path);
  }
  if (values.version !== undefined && typeof values.version !== "string") {
    throw new Error("version must be a string literal");
  }
  if (
    values.tier !== undefined &&
    !["observe", "query", "navigate", "mutate"].includes(String(values.tier))
  ) {
    throw new Error("tier must be observe, query, navigate or mutate");
  }
  if (
    values.sideEffect !== undefined &&
    !["none", "ui", "external"].includes(String(values.sideEffect))
  ) {
    throw new Error("sideEffect must be none, ui or external");
  }
  if (
    values.replayPolicy !== undefined &&
    !["safe", "idempotency-key", "never"].includes(String(values.replayPolicy))
  ) {
    throw new Error("replayPolicy is invalid");
  }
  if (
    values.riskLevel !== undefined &&
    !["low", "medium", "high"].includes(String(values.riskLevel))
  ) {
    throw new Error("riskLevel must be low, medium or high");
  }
  if (
    values.requiresConfirmation !== undefined &&
    typeof values.requiresConfirmation !== "boolean"
  ) {
    throw new Error("requiresConfirmation must be a boolean literal");
  }
  if (
    values.maxOutputBytes !== undefined &&
    (typeof values.maxOutputBytes !== "number" || values.maxOutputBytes <= 0)
  ) {
    throw new Error("maxOutputBytes must be a positive number literal");
  }
  return values as Partial<BuildDescriptor>;
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

function objectKey(property: t.ObjectMember): string | undefined {
  if (property.computed) return undefined;
  if (t.isIdentifier(property.key)) return property.key.name;
  if (t.isStringLiteral(property.key)) return property.key.value;
  return undefined;
}

function objectProperty(
  object: t.ObjectExpression,
  name: string,
): t.ObjectProperty | t.ObjectMethod | undefined {
  return object.properties.find(
    (property): property is t.ObjectProperty | t.ObjectMethod =>
      (t.isObjectProperty(property) || t.isObjectMethod(property)) &&
      objectKey(property) === name,
  );
}

function staticStringProperty(
  object: t.ObjectExpression,
  name: string,
  path: NodePath<t.VariableDeclarator>,
  required = true,
): string | undefined {
  const property = objectProperty(object, name);
  if (!property) {
    if (required) throw new Error(`${name} must be a string literal`);
    return undefined;
  }
  if (!t.isObjectProperty(property)) {
    throw new Error(`${name} must be a string literal`);
  }
  const value = staticJsonValue(property.value, path);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string literal`);
  }
  return value.trim();
}

function emitResourceProviderDescriptors(
  options: t.ObjectExpression,
  path: NodePath<t.VariableDeclarator>,
  onDescriptor?: (descriptor: BuildDescriptor) => void,
): void {
  let namespace: string;
  let description: string;
  try {
    namespace = staticStringProperty(options, "namespace", path)!;
    description = staticStringProperty(options, "description", path)!;
  } catch (error) {
    throw path.buildCodeFrameError(
      `Cannot emit Resource Provider manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/gu, "_");
  const base = {
    namespace: safeNamespace,
    version: "1.0.0",
    riskLevel: "low" as const,
    requiresConfirmation: false,
  };
  onDescriptor?.({
    ...base,
    name: `${safeNamespace}_search`,
    description: `Search ${description}. Use this for lists, discovery, status and ambiguous names.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string" },
        filters: { type: "object" },
      },
      additionalProperties: false,
    },
    tier: "query",
    sideEffect: "none",
    replayPolicy: "safe",
    deferLoading: true,
    resource: {
      namespace: safeNamespace,
      operation: "search",
      inputKey: "query",
    },
  });

  if (objectProperty(options, "get")) {
    onDescriptor?.({
      ...base,
      name: `${safeNamespace}_get`,
      description: `Get one ${description} resource by its stable id.`,
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
      tier: "query",
      sideEffect: "none",
      replayPolicy: "safe",
      deferLoading: true,
      resource: {
        namespace: safeNamespace,
        operation: "get",
        inputKey: "id",
      },
    });
  }

  const actionsProperty = objectProperty(options, "actions");
  if (!actionsProperty || !t.isObjectProperty(actionsProperty)) return;
  if (!t.isObjectExpression(actionsProperty.value)) {
    throw path.buildCodeFrameError(
      "Cannot emit Resource Provider manifest: actions must be an object literal",
    );
  }
  for (const actionProperty of actionsProperty.value.properties) {
    if (
      !t.isObjectProperty(actionProperty) ||
      !t.isObjectExpression(actionProperty.value)
    ) {
      throw path.buildCodeFrameError(
        "Cannot emit Resource Provider manifest: every action must be an object literal",
      );
    }
    const action = objectKey(actionProperty);
    if (!action) {
      throw path.buildCodeFrameError(
        "Cannot emit Resource Provider manifest: action keys must be static",
      );
    }
    const definition = actionProperty.value;
    let toolName: string;
    let actionDescription: string;
    let tier: ToolTier;
    try {
      toolName =
        staticStringProperty(definition, "toolName", path, false) ??
        `${safeNamespace}_${action}`;
      actionDescription = staticStringProperty(
        definition,
        "description",
        path,
      )!;
      const declaredTier = staticStringProperty(
        definition,
        "tier",
        path,
        false,
      );
      if (
        declaredTier &&
        !["observe", "query", "navigate"].includes(declaredTier)
      ) {
        throw new Error(
          "resource action tier must be observe, query or navigate",
        );
      }
      tier = (declaredTier as ToolTier | undefined) ?? "navigate";
    } catch (error) {
      throw path.buildCodeFrameError(
        `Cannot emit Resource Provider action ${action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    onDescriptor?.({
      ...base,
      name: toolName,
      description: actionDescription,
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", minLength: 1 } },
        required: ["query"],
        additionalProperties: false,
      },
      tier,
      sideEffect: "ui",
      replayPolicy: "safe",
      resource: {
        namespace: safeNamespace,
        operation: "action",
        action,
        inputKey: "query",
      },
    });
  }
}

export function transformSpotlightClientTools(
  code: string,
  id: string,
  onDescriptor?: (descriptor: BuildDescriptor) => void,
) {
  if (
    !code.includes("defineClientTool") &&
    !code.includes("defineResourceProvider")
  ) {
    return null;
  }
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    sourceFilename: id,
  });
  const edits: Array<
    | { kind: "insert"; position: number; text: string }
    | { kind: "replace"; start: number; end: number; text: string }
  > = [];
  traverseAst(ast, {
    VariableDeclarator(path) {
      if (!t.isIdentifier(path.node.id) || !t.isCallExpression(path.node.init))
        return;
      const call = path.node.init;
      if (t.isIdentifier(call.callee, { name: "defineResourceProvider" })) {
        const options = call.arguments[0];
        if (!t.isObjectExpression(options)) {
          throw path.buildCodeFrameError(
            "defineResourceProvider options must be an object literal",
          );
        }
        emitResourceProviderDescriptors(options, path, onDescriptor);
        return;
      }
      if (!t.isIdentifier(call.callee, { name: "defineClientTool" })) return;
      if (call.arguments.length < 1 || call.arguments.length > 2) {
        throw path.buildCodeFrameError(
          "defineClientTool expects handler and optional options",
        );
      }
      const fn = handlerFunction(call.arguments[0]);
      if (!fn)
        throw path.buildCodeFrameError(
          "defineClientTool handler must be inline",
        );
      const description = jsDoc(path);
      if (!description) {
        throw path.buildCodeFrameError(
          `Client tool ${path.node.id.name} needs a JSDoc description`,
        );
      }
      const optionArg = call.arguments[1];
      if (optionArg && !t.isObjectExpression(optionArg)) {
        throw path.buildCodeFrameError(
          "Client tool options must be an object literal",
        );
      }
      let descriptorOptions: Partial<BuildDescriptor> = {};
      try {
        descriptorOptions = staticToolOptions(optionArg, path);
      } catch (error) {
        throw path.buildCodeFrameError(
          `Invalid static options for ${path.node.id.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const hasExplicitSchema = optionArg?.properties.some(
        (property) =>
          t.isObjectProperty(property) &&
          t.isIdentifier(property.key, { name: "schema" }),
      );
      let schema: { input: JsonSchema; output?: JsonSchema } | undefined;
      if (!hasExplicitSchema) {
        try {
          schema = { input: inputSchema(fn), output: outputSchema(fn) };
        } catch (error) {
          throw path.buildCodeFrameError(
            `Cannot infer schema for ${path.node.id.name}: ${error instanceof Error ? error.message : String(error)}. Add { schema: { input, output } } as the second argument.`,
          );
        }
      }
      const generated = [
        `name:${JSON.stringify(path.node.id.name)}`,
        `description:${JSON.stringify(description)}`,
        ...(schema ? [`schema:${JSON.stringify(schema)}`] : []),
      ].join(",");
      if (schema) {
        onDescriptor?.(
          withTier({
            name: path.node.id.name,
            version: "1.0.0",
            description,
            inputSchema: schema.input,
            outputSchema: schema.output,
            sideEffect: "ui",
            replayPolicy: "never",
            riskLevel: "low",
            requiresConfirmation: false,
            ...descriptorOptions,
          }),
        );
      } else if (optionArg) {
        const schemaProperty = optionArg.properties.find(
          (property): property is t.ObjectProperty =>
            t.isObjectProperty(property) &&
            t.isIdentifier(property.key, { name: "schema" }),
        );
        if (schemaProperty) {
          try {
            const parsed = staticJsonValue(schemaProperty.value, path) as {
              input: JsonSchema;
              output?: JsonSchema;
            };
            if (!parsed?.input || typeof parsed.input !== "object") {
              throw new Error("schema.input must be an object");
            }
            onDescriptor?.(
              withTier({
                name: path.node.id.name,
                version: "1.0.0",
                description,
                inputSchema: parsed.input,
                outputSchema: parsed.output,
                sideEffect: "ui",
                replayPolicy: "never",
                riskLevel: "low",
                requiresConfirmation: false,
                ...descriptorOptions,
              }),
            );
          } catch (error) {
            if (onDescriptor) {
              throw path.buildCodeFrameError(
                `Cannot emit production schema for ${path.node.id.name}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }
      }
      if (optionArg) {
        edits.push({
          kind: "replace",
          start: optionArg.start!,
          end: optionArg.end!,
          text: `{ ...${code.slice(optionArg.start!, optionArg.end!)}, ${generated} }`,
        });
      } else {
        const gapBeforeClose = code.slice(
          call.arguments[0].end!,
          call.end! - 1,
        );
        const separator = gapBeforeClose.includes(",") ? "" : ",";
        edits.push({
          kind: "insert",
          position: call.end! - 1,
          text: `${separator} { ${generated} }`,
        });
      }
    },
  });
  if (!edits.length) return null;
  const magic = new MagicString(code);
  const editPosition = (edit: (typeof edits)[number]) =>
    edit.kind === "insert" ? edit.position : edit.start;
  for (const edit of edits.sort((a, b) => editPosition(b) - editPosition(a))) {
    if (edit.kind === "insert") magic.appendLeft(edit.position, edit.text);
    else magic.overwrite(edit.start, edit.end, edit.text);
  }
  return { code: magic.toString(), map: magic.generateMap({ hires: true }) };
}

export default function spotlightClientTools(
  options: SpotlightClientToolsOptions = {},
): Plugin {
  const include = options.include ?? "/src/";
  const descriptors = new Map<string, BuildDescriptor>();
  let productionBuild = false;
  return {
    name: "spotlight-client-tools",
    enforce: "pre",
    configResolved(config) {
      productionBuild =
        config.command === "build" && config.mode === "production";
      if (
        productionBuild &&
        (!options.projectId?.trim() || !options.frontendBuildId?.trim())
      ) {
        throw new Error(
          "spotlightClientTools: projectId and frontendBuildId are required for production builds",
        );
      }
    },
    transform(code, id) {
      if (!shouldInclude(id, include)) return null;
      return transformSpotlightClientTools(code, id, (descriptor) => {
        descriptors.set(descriptor.name, descriptor);
      });
    },
    generateBundle() {
      if (!productionBuild) return;
      if (descriptors.size === 0) {
        throw new Error(
          "spotlightClientTools: production manifest has no tools",
        );
      }
      const unsupported = [...descriptors.values()]
        .filter((descriptor) => descriptor.tier === "mutate")
        .map((descriptor) => descriptor.name);
      if (unsupported.length > 0) {
        throw new Error(
          `spotlightClientTools: the runtime cannot dispatch "mutate" tier tools yet: ${unsupported.join(", ")}. See docs/design/capability-protocol-v2.md.`,
        );
      }
      const unsigned = {
        protocolVersion: "spotlight.capabilities/1" as const,
        projectId: options.projectId!.trim(),
        frontendBuildId: options.frontendBuildId!.trim(),
        tools: [...descriptors.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      };
      const manifest = {
        ...unsigned,
        manifestDigest: `sha256:${createHash("sha256")
          .update(stableJson(unsigned))
          .digest("hex")}`,
      };
      this.emitFile({
        type: "asset",
        fileName: options.manifestFileName ?? "spotlight-client-manifest.json",
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}
