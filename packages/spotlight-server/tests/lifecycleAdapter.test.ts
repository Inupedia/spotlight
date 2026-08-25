import { SpotlightLifecycleProjector } from "../src/lifecycleAdapter.js";
import type { SpotlightServerRunEvent } from "../src/runManager.js";

describe("SpotlightLifecycleProjector", () => {
  it("turns routing, Skill selection and Tool execution into stable Items", () => {
    const projector = new SpotlightLifecycleProjector("thread-1", "turn-1", 1);
    const legacy: SpotlightServerRunEvent[] = [
      {
        type: "turn_transition",
        at: 2,
        seq: 1,
        turnId: "legacy-turn",
        phase: "router_done",
        summary: "识别为页面操作；命中 Skill：skill.monitoring；将选择工具。",
      },
      {
        type: "tool_start",
        at: 3,
        seq: 2,
        iteration: 1,
        call: {
          id: "call-1",
          name: "panel.openVideo",
          displayName: "打开视频",
          input: { name: "泸定取水口" },
        },
      },
      {
        type: "tool_result",
        at: 4,
        seq: 3,
        iteration: 1,
        result: {
          call: {
            id: "call-1",
            name: "panel.openVideo",
            displayName: "打开视频",
            input: { name: "泸定取水口" },
          },
          success: true,
          summary: "已打开",
          output: { opened: true },
          trace: [],
        },
      },
    ];
    const events = [
      projector.startEvent(),
      ...legacy.flatMap((event) => projector.project(event)),
    ];

    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "item.completed",
        item: expect.objectContaining({ type: "skill_use", skill: "skill.monitoring" }),
      }),
      expect.objectContaining({
        type: "item.started",
        item: expect.objectContaining({ type: "tool_call", tool: "panel.openVideo" }),
      }),
      expect.objectContaining({
        type: "item.completed",
        item: expect.objectContaining({ type: "tool_call", status: "completed" }),
      }),
    ]));
  });
});
