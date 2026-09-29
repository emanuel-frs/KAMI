import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const htmlUrl = new URL("../../docs/index.html", import.meta.url);

async function openPage(platform, fetchImpl) {
  const html = await readFile(htmlUrl, "utf8");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.defineProperty(window.navigator, "platform", { value: platform });
      window.fetch = fetchImpl;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return dom;
}

test("página de download apresenta os assets Linux da última release", async (t) => {
  const dom = await openPage("Linux x86_64", async () => ({
    ok: true,
    json: async () => ({
      tag_name: "v1.7.2",
      assets: [
        { name: "kami-1.7.2-linux-amd64.deb", browser_download_url: "https://example.test/kami.deb" },
        { name: "kami-1.7.2-linux-x86_64.rpm", browser_download_url: "https://example.test/kami.rpm" },
        { name: "kami-1.7.2-linux-x86_64.AppImage", browser_download_url: "https://example.test/kami.AppImage" },
        { name: "SHA256SUMS", browser_download_url: "https://example.test/SHA256SUMS" },
      ],
    }),
  }));
  t.after(() => dom.window.close());

  const links = [...dom.window.document.querySelectorAll("#downloads a")];
  assert.deepEqual(links.map((link) => link.href), [
    "https://example.test/kami.deb",
    "https://example.test/kami.rpm",
    "https://example.test/kami.AppImage",
    "https://example.test/SHA256SUMS",
  ]);
  assert.match(dom.window.document.querySelector("#commands").textContent, /sha256sum --ignore-missing --check SHA256SUMS/);
  assert.match(dom.window.document.querySelector("#commands").textContent, /kami-1\.7\.2-linux-amd64\.deb/);
});

test("página de download oferece Releases quando a API está offline", async (t) => {
  const dom = await openPage("Linux x86_64", async () => {
    throw new Error("offline");
  });
  t.after(() => dom.window.close());

  const fallback = dom.window.document.querySelector("#fallback");
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.querySelector("a").href, "https://github.com/emanuel-frs/KAMI/releases/latest");
  assert.match(dom.window.document.querySelector("#status").textContent, /consulta à release falhou/);
});

test("página de download evita comandos de assets ausentes", async (t) => {
  const dom = await openPage("Linux x86_64", async () => ({
    ok: true,
    json: async () => ({ tag_name: "v1.7.2", assets: [] }),
  }));
  t.after(() => dom.window.close());

  assert.equal(dom.window.document.querySelector("#downloads").childElementCount, 0);
  assert.equal(dom.window.document.querySelector("#commands").hidden, true);
  assert.equal(dom.window.document.querySelector("#fallback").hidden, false);
});

test("página dá suporte aos nomes Tauri antigos sem sugerir checksum inexistente", async (t) => {
  const dom = await openPage("Linux x86_64", async () => ({
    ok: true,
    json: async () => ({
      tag_name: "v1.7.2",
      assets: [
        { name: "Kami_1.7.2_amd64.deb", browser_download_url: "https://example.test/legacy.deb" },
        { name: "Kami-1.7.2-1.x86_64.rpm", browser_download_url: "https://example.test/legacy.rpm" },
        { name: "Kami_1.7.2_amd64.AppImage", browser_download_url: "https://example.test/legacy.AppImage" },
      ],
    }),
  }));
  t.after(() => dom.window.close());

  const links = [...dom.window.document.querySelectorAll("#downloads a")];
  assert.equal(links.length, 3);
  assert.equal(links[0].href, "https://example.test/legacy.deb");
  assert.equal(dom.window.document.querySelector("#commands").hidden, true);
  assert.match(dom.window.document.querySelector("#status").textContent, /não publicou SHA256SUMS/);
});

test("página de download apresenta o instalador Windows", async (t) => {
  const dom = await openPage("Windows", async () => ({
    ok: true,
    json: async () => ({
      tag_name: "v1.7.2",
      assets: [
        { name: "kami-1.7.2-windows-x64-setup.exe", browser_download_url: "https://example.test/kami-setup.exe" },
      ],
    }),
  }));
  t.after(() => dom.window.close());

  const link = dom.window.document.querySelector("#downloads a");
  assert.equal(link.textContent, "Baixar para Windows (.exe)");
  assert.equal(link.href, "https://example.test/kami-setup.exe");
});
