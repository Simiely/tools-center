// tests/favicon.test.mjs - 网站图标抓取纯函数单测(extractFaviconUrl / safeBase)
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFaviconUrl, safeBase } from "../lib/core/favicon.js";

test("safeBase:合法 http/https 返回 origin", () => {
  assert.equal(safeBase("https://example.com/path?a=1"), "https://example.com");
  assert.equal(safeBase("http://192.168.1.100:8096/"), "http://192.168.1.100:8096");
});

test("safeBase:非法输入返回 null", () => {
  assert.equal(safeBase(""), null);
  assert.equal(safeBase("not-a-url"), null);
  assert.equal(safeBase("ftp://x.com"), null);
  assert.equal(safeBase(null), null);
});

test("extractFaviconUrl:标准 link rel=icon 绝对路径", () => {
  const html = '<html><head><link rel="icon" href="https://cdn.example.com/favicon.ico"></head></html>';
  assert.equal(extractFaviconUrl(html, "https://example.com"), "https://cdn.example.com/favicon.ico");
});

test("extractFaviconUrl:相对路径按 origin 拼绝对", () => {
  const html = '<link rel="icon" href="/assets/favicon.png">';
  assert.equal(extractFaviconUrl(html, "https://example.com:8443"), "https://example.com:8443/assets/favicon.png");
});

test("extractFaviconUrl:shortcut icon / apple-touch-icon 也识别", () => {
  assert.equal(
    extractFaviconUrl('<link rel="shortcut icon" href="/favicon.ico">', "https://a.com"),
    "https://a.com/favicon.ico"
  );
  assert.equal(
    extractFaviconUrl('<link rel="apple-touch-icon" href="//cdn.a.com/touch.png">', "https://a.com"),
    "https://cdn.a.com/touch.png"
  );
});

test("extractFaviconUrl:无 icon 标签返回 null(存在性由 fetchFavicon HEAD 校验)", () => {
  assert.equal(extractFaviconUrl("<html><body>no icon</body></html>", "https://example.com"), null);
});

test("extractFaviconUrl:空 html / 坏 base 返回 null", () => {
  assert.equal(extractFaviconUrl("", "https://example.com"), null);
  assert.equal(extractFaviconUrl("<link rel=icon href=/x.png>", null), null);
});

test("extractFaviconUrl:protocol-relative href(//) 正确处理", () => {
  assert.equal(
    extractFaviconUrl('<link rel="icon" href="//icons.example.com/f.ico">', "https://a.com"),
    "https://icons.example.com/f.ico"
  );
});
