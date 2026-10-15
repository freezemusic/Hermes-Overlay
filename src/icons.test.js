import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function pngSize(path) {
  const buf = readFileSync(new URL(path, import.meta.url));
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function icnsPngSizes(path) {
  const buf = readFileSync(new URL(path, import.meta.url));
  assert.equal(buf.subarray(0, 4).toString("ascii"), "icns");
  const sizes = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const size = buf.readUInt32BE(off + 4);
    if (size < 8) break;
    const chunk = buf.subarray(off + 8, off + size);
    if (chunk.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && chunk.length >= 24) {
      sizes.push({ w: chunk.readUInt32BE(16), h: chunk.readUInt32BE(20) });
    }
    off += size;
  }
  return sizes;
}

test("app icons are generated from a 1024 source and retina slots are full pixels", () => {
  assert.deepEqual(pngSize("../src-tauri/icons/icon-1024.png"), { w: 1024, h: 1024 });
  assert.deepEqual(pngSize("../src-tauri/icons/128x128.png"), { w: 128, h: 128 });
  assert.deepEqual(pngSize("../src-tauri/icons/128x128@2x.png"), { w: 256, h: 256 });
  const tray = pngSize("../src-tauri/icons/tray.png");
  assert.equal(tray.w, tray.h);
  assert.ok(tray.w >= 22 && tray.w <= 44);
  const icns = icnsPngSizes("../src-tauri/icons/icon.icns");
  assert.ok(icns.some((size) => size.w === 512 && size.h === 512));
  assert.ok(icns.some((size) => size.w === 1024 && size.h === 1024));
});
