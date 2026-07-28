import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the AimTune product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AimTune — FPS 灵敏度测试与换算<\/title>/i);
  assert.match(html, /别再凭感觉/);
  assert.match(html, /开始测试/);
  assert.match(html, /匿名模式/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("removes starter-only preview code and metadata", async () => {
  const [page, layout, styles, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /SkeletonPreview|_sites-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(page, /cmPer360/);
  assert.match(page, /aimtune-history/);
  assert.match(page, /const HIT_TARGET = 20/);
  assert.match(page, /const MULTI_HIT_TARGET = 30/);
  assert.match(page, /log-softmax-v0\.2/);
  assert.match(page, /requestPointerLock/);
  assert.match(page, /pointScoresRef/);
  assert.match(page, /averagePrecision \* 0\.65/);
  assert.match(page, /实时得分/);
  assert.match(page, /指针锁定后可无限向下移动/);
  assert.match(page, /按住画布会再次尝试启用/);
  assert.match(page, /tracking-feedback/);
  assert.match(styles, /@keyframes tracking-path/);
  assert.match(styles, /\.tracking-target\.locked span/);
  assert.match(layout, /aimtune-social\.svg/);
});
