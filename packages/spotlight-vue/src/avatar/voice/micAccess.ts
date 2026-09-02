export function microphoneAccessMessage(err?: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  const insecure =
    typeof window !== "undefined" && window.isSecureContext === false;
  const missingApi =
    typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia;

  if (insecure) {
    return "当前不是安全连接，浏览器不允许使用麦克风。请通过 HTTPS 打开本页，或改用打字发送。";
  }
  if (missingApi) {
    return "当前浏览器没有开放麦克风。请允许本站点使用麦克风后重试。";
  }
  if (/NotAllowed|Permission|NotReadable/i.test(raw)) {
    return "麦克风权限被拒绝。请在浏览器地址栏允许麦克风后重试。";
  }
  if (/NotFound/i.test(raw)) {
    return "没有检测到麦克风设备。";
  }
  if (/getUserMedia|mediaDevices/i.test(raw)) {
    return "无法打开麦克风。请允许浏览器使用麦克风，或改用打字发送。";
  }
  return raw || "无法启动语音录制。";
}

export function assertMicrophoneAvailable(): void {
  const message = microphoneAccessMessage();
  const missingApi =
    typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia;
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new Error(message);
  }
  if (missingApi) {
    throw new Error(message);
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("当前浏览器不支持录音。");
  }
}

export async function getMicrophoneStream(): Promise<MediaStream> {
  assertMicrophoneAvailable();
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw new Error(microphoneAccessMessage(err));
  }
}
