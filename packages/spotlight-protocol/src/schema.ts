/** Machine-readable wire schema generated into the package during build. */
export const SPOTLIGHT_APP_SCHEMA_V1 = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://inupedia.com/schemas/spotlight-app-v1.json",
  title: "Spotlight App Protocol v1",
  type: "object",
  $defs: {
    initializeRequest: {
      type: "object",
      additionalProperties: false,
      required: ["protocolVersion", "projectId", "clientInfo", "capabilities", "toolManifest"],
      properties: {
        protocolVersion: { const: "spotlight.app/1" },
        projectId: { type: "string", minLength: 1 },
        clientInfo: { type: "object" },
        capabilities: { type: "object" },
        toolManifest: { type: "object" },
        skills: { type: "array" },
        skillDefinitions: { type: "array" },
      },
    },
    turnStartRequest: {
      type: "object",
      required: ["input"],
      properties: {
        input: { type: "string", minLength: 1 },
        capabilitySessionId: { type: "string" },
        outputSchema: { type: "object" },
        additionalContext: { type: "object" },
        policy: { type: "object" },
      },
    },
    turnEvent: {
      type: "object",
      required: ["type", "at", "seq", "threadId", "turnId"],
      properties: {
        type: {
          enum: [
            "turn.started",
            "item.started",
            "item.updated",
            "item.completed",
            "turn.completed",
            "turn.failed",
            "ping",
          ],
        },
        at: { type: "number" },
        seq: { type: "integer", minimum: 1 },
        threadId: { type: "string" },
        turnId: { type: "string" },
      },
    },
  },
} as const;
