export const SETUP_BANNER = "未設定 gateway。撳呢度填 Gateway 位址同 API 金鑰。";

export const SETUP_HINT =
  "第一次用：Gateway 位址填 http://127.0.0.1:8642，每個 Bot 填 API 金鑰，然後儲存。";

/** No config file yet. A saved empty gateway stays in demo mode without reopening Settings. */
export function shouldAutoOpenSettings(settings) {
  return settings?.needs_setup === true;
}

/** Empty gateway: the banner is a button that opens Settings. */
export function bannerOpensSettings(settings) {
  if (!settings || settings.mode !== "mock") return false;
  return !String(settings.gateway_base_url || "").trim();
}

export function setupHintVisible(gatewayUrl) {
  return !String(gatewayUrl || "").trim();
}
