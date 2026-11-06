export const SETUP_BANNER = "未設定。撳呢度喺設定填 Kanban server 同登入 Hermes Dashboard。";

export const SETUP_HINT =
  "第一次用：Kanban server 填 hermes serve 嘅位址（留空就係 http://127.0.0.1:9119），登入，然後儲存。";

/** Shown while the offline demo runs. Demo is only the `--demo` launch flag. */
export const DEMO_BANNER = "示範模式（--demo）：假 Bot，冇連 Hermes。";

/** No config file yet. */
export function shouldAutoOpenSettings(settings) {
  return settings?.needs_setup === true;
}

/** The first-run hint shows only while there is no config file. */
export function setupHintVisible(settings) {
  return settings?.needs_setup === true;
}
