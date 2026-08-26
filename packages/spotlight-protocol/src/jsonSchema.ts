import type { JsonSchemaV1 } from "./capabilities.js";

export interface JsonSchemaValidationIssue {
  path: string;
  message: string;
}

export interface JsonSchemaValidationResult {
  valid: boolean;
  issues: JsonSchemaValidationIssue[];
}

type Schema = JsonSchemaV1 & {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  oneOf?: unknown[];
  anyOf?: unknown[];
  allOf?: unknown[];
  not?: unknown;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | unknown;
  items?: unknown;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
};

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return Boolean(
        value && typeof value === "object" && !Array.isArray(value),
      );
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

function validateAt(
  value: unknown,
  rawSchema: unknown,
  path: string,
): JsonSchemaValidationIssue[] {
  if (rawSchema === true || rawSchema == null) return [];
  if (rawSchema === false) return [{ path, message: "value is not allowed" }];
  if (typeof rawSchema !== "object" || Array.isArray(rawSchema)) return [];
  const schema = rawSchema as Schema;

  if ("const" in schema && !Object.is(value, schema.const)) {
    return [{ path, message: "value does not match const" }];
  }
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    return [{ path, message: "value is not in enum" }];
  }
  for (const [keyword, branches, mode] of [
    ["oneOf", schema.oneOf, "one"],
    ["anyOf", schema.anyOf, "any"],
  ] as const) {
    if (!branches) continue;
    const matches = branches.filter(
      (branch) => validateAt(value, branch, path).length === 0,
    ).length;
    if (
      (mode === "one" && matches !== 1) ||
      (mode === "any" && matches === 0)
    ) {
      return [{ path, message: `value does not satisfy ${keyword}` }];
    }
  }
  if (schema.allOf) {
    const issues = schema.allOf.flatMap((branch) =>
      validateAt(value, branch, path),
    );
    if (issues.length > 0) return issues;
  }
  if (schema.not && validateAt(value, schema.not, path).length === 0) {
    return [{ path, message: "value matches forbidden schema" }];
  }

  const types =
    typeof schema.type === "string" ? [schema.type] : (schema.type ?? []);
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    return [{ path, message: `expected ${types.join(" or ")}` }];
  }

  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) {
      return [
        {
          path,
          message: `must contain at least ${schema.minLength} characters`,
        },
      ];
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      return [
        {
          path,
          message: `must contain at most ${schema.maxLength} characters`,
        },
      ];
    }
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern, "u").test(value)) {
          return [{ path, message: "does not match pattern" }];
        }
      } catch {
        return [{ path, message: "schema contains an invalid pattern" }];
      }
    }
  }

  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) {
      return [{ path, message: `must be >= ${schema.minimum}` }];
    }
    if (schema.maximum != null && value > schema.maximum) {
      return [{ path, message: `must be <= ${schema.maximum}` }];
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      return [
        { path, message: `must contain at least ${schema.minItems} items` },
      ];
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      return [
        { path, message: `must contain at most ${schema.maxItems} items` },
      ];
    }
    if (schema.items) {
      return value.flatMap((item, index) =>
        validateAt(item, schema.items, `${path}[${index}]`),
      );
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    const requiredIssues = (schema.required ?? []).flatMap((key) => {
      const item = record[key];
      return item === undefined ||
        item === null ||
        (typeof item === "string" && !item.trim())
        ? [{ path: `${path}.${key}`, message: "is required" }]
        : [];
    });
    const propertyIssues = Object.entries(record).flatMap(([key, item]) => {
      if (key in properties)
        return validateAt(item, properties[key], `${path}.${key}`);
      if (schema.additionalProperties === false) {
        return [
          {
            path: `${path}.${key}`,
            message: "additional property is not allowed",
          },
        ];
      }
      if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      ) {
        return validateAt(item, schema.additionalProperties, `${path}.${key}`);
      }
      return [];
    });
    return [...requiredIssues, ...propertyIssues];
  }
  return [];
}

export function validateJsonSchemaValue(
  value: unknown,
  schema: JsonSchemaV1 | undefined,
): JsonSchemaValidationResult {
  const issues = schema ? validateAt(value, schema, "$") : [];
  return { valid: issues.length === 0, issues };
}
