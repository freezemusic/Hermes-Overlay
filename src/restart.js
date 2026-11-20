// R-SY-13: tray 「重啟」. Drafts and attachments live only in the page, so a
// restart would lose them; ask first.

/** Panels that still hold unsent text or staged attachments. */
export function unsentPanels(rows) {
  return (rows || []).filter((row) => String(row?.text ?? "").trim() !== "" || Number(row?.attachments) > 0);
}

export function restartConfirmText(rows) {
  const n = unsentPanels(rows).length;
  return n
    ? `有 ${n} 個面板仲有未送出嘅文字或附件，重啟之後會冇晒。仍然重啟？`
    : "";
}
