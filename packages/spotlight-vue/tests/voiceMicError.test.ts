import { describe, expect, it } from "vitest";
import { describeMicrophoneError } from "../src/avatar/voice/voiceSession.js";

describe("describeMicrophoneError", () => {
  it("maps permission and missing-device failures to Chinese copy", () => {
    expect(describeMicrophoneError(new DOMException("denied", "NotAllowedError"))).toContain(
      "允许浏览器使用麦克风",
    );
    expect(
      describeMicrophoneError(new DOMException("Requested device not found", "NotFoundError")),
    ).toContain("没有找到麦克风");
    expect(describeMicrophoneError(new Error("microphone publish timed out"))).toContain(
      "连接超时",
    );
  });
});
