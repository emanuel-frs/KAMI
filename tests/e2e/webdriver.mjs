/**
 * Cliente WebDriver mínimo (W3C) pro teste ponta a ponta do Kami (CONF-03).
 *
 * Por que não WebdriverIO/Selenium: o que o teste precisa é pouco —
 * abrir sessão, rodar JS na página, mudar o tamanho da janela, tirar print
 * e fechar —, e cada um disso é um POST/GET JSON. Um cliente de ~80 linhas
 * com o `fetch` do Node evita uma dependência nova (com dezenas de
 * pacotes transitivos) só pro CI.
 *
 * Fala com o `tauri-driver` (oficial do Tauri), que repassa pro driver
 * nativo do sistema: WebKitWebDriver no Linux, msedgedriver no Windows.
 */

export class WebDriver {
  constructor(baseUrl = "http://127.0.0.1:4444") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.sessionId = null;
  }

  async #call(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // resposta não-JSON: cai no erro abaixo com o texto cru
    }
    if (!res.ok || json?.value?.error) {
      const err = json?.value;
      throw new Error(`WebDriver ${method} ${path}: ${err?.error || res.status} ${err?.message || text.slice(0, 300)}`);
    }
    return json?.value;
  }

  #session(path) {
    if (!this.sessionId) throw new Error("WebDriver: sem sessão aberta");
    return `/session/${this.sessionId}${path}`;
  }

  /** Abre o app (o tauri-driver sobe o executável indicado). */
  async start(application) {
    const value = await this.#call("POST", "/session", {
      capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application } } },
    });
    this.sessionId = value.sessionId;
    return value;
  }

  /** Roda `script` (corpo de função) na página. Promises são esperadas. */
  execute(script, ...args) {
    return this.#call("POST", this.#session("/execute/async"), {
      script: `const done = arguments[arguments.length - 1];
        Promise.resolve((function () { ${script} }).apply(null, Array.from(arguments).slice(0, -1)))
          .then((v) => done({ ok: true, v }), (e) => done({ ok: false, e: String(e && e.stack || e) }));`,
      args,
    }).then((r) => {
      if (!r?.ok) throw new Error(`erro no script da página: ${r?.e}`);
      return r.v;
    });
  }

  refresh() {
    return this.#call("POST", this.#session("/refresh"), {});
  }

  /** Muda o tamanho da janela; devolve false se o driver não suportar. */
  async setWindowSize(width, height) {
    try {
      await this.#call("POST", this.#session("/window/rect"), { width, height });
      return true;
    } catch {
      return false;
    }
  }

  /** PNG da área visível, como Buffer. */
  async screenshot() {
    return Buffer.from(await this.#call("GET", this.#session("/screenshot")), "base64");
  }

  async quit() {
    if (!this.sessionId) return;
    try {
      await this.#call("DELETE", this.#session(""));
    } finally {
      this.sessionId = null;
    }
  }
}
