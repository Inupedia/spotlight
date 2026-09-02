import { describe, expect, it } from "vitest";
import {
  isWeChatInAppBrowser,
  voiceRemotePageDirectory,
  voiceRemotePageUrl,
} from "../src/avatar/voice/phonePairing.js";

describe("phone voice pairing helpers", () => {
  it("detects WeChat in-app browsers that cannot open the mic", () => {
    expect(
      isWeChatInAppBrowser("Mozilla/5.0 MicroMessenger/8.0.5 iPhone"),
    ).toBe(true);
    expect(isWeChatInAppBrowser("Mozilla/5.0 wxwork")).toBe(true);
    expect(
      isWeChatInAppBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605",
      ),
    ).toBe(false);
  });

  it("builds the phone page URL from the public site origin and host app path", () => {
    expect(voiceRemotePageDirectory("/web/ydjm-construction-map/")).toBe(
      "/web/ydjm-construction-map/",
    );
    expect(voiceRemotePageDirectory("/web/ydjm-construction-map")).toBe(
      "/web/ydjm-construction-map/",
    );
    expect(voiceRemotePageDirectory("/web/ydjm-construction-map/index.html")).toBe(
      "/web/ydjm-construction-map/",
    );
    expect(
      voiceRemotePageUrl("abc", {
        origin: "https://ydjm.scxhgs.cn:19088",
        pathname: "/web/ydjm-construction-map/",
      }),
    ).toBe(
      "https://ydjm.scxhgs.cn:19088/web/ydjm-construction-map/voice-remote.html?p=abc",
    );
  });
});
