/**
 * Tela de bloqueio do PIN (SEG-02).
 *
 * O PIN é opcional (configurações › segurança). Ligado, o backend nasce
 * bloqueado e responde 423 a tudo menos o desbloqueio (app/pin.py) — esta
 * tela é só a frente disso:
 *
 * - `garantirDesbloqueio()`: chamada no boot antes de carregar qualquer
 *   dado; se o PIN está ligado e o app bloqueado, mostra a tela e só
 *   resolve depois do PIN certo. Sem backend (status 0), resolve na hora
 *   e o vigia (CONF-02) cuida do resto.
 * - `wireLockScreen()`: qualquer 423 no meio do uso (o vigia reiniciou o
 *   backend, que nasce bloqueado — P-19) mostra a tela; ao desbloquear, o
 *   app recarrega inteiro, porque as telas abertas falharam no meio.
 * - `startInactivityLock()`: bloqueio por inatividade (P-06), opcional e
 *   desligado por padrão; quem conta o tempo é a tela, o backend só
 *   recebe o "bloquear". Ao desbloquear daí, nada recarrega.
 *
 * Fica abaixo da barra de título (minimizar/fechar continuam valendo) e o
 * resto da página fica `inert` enquanto ela está aberta.
 */
import {
  desbloquearPin,
  bloquearPin,
  getPin,
  recuperarPin,
} from "../api/seguranca.js";
import { ApiError } from "../api/client.js";
import { copyText } from "./clipboard.js";
import { escapeHtml } from "./format.js";
import { icon } from "./icons.js";

const PIN_MIN = 4;
const PIN_MAX = 8;
const ATIVIDADE = ["pointerdown", "keydown", "wheel", "touchstart"];

let aberta = null; // { el, resolve, recarregar }
let inatividadeMin = null;
let ultimaAtividade = Date.now();
let inatividadeTimer = null;

// ── código de recuperação (usado aqui e em configurações › segurança) ──

export function codigoRecuperacaoHtml(codigo) {
  return `
    <div class="lock-codigo" data-codigo="${escapeHtml(codigo)}">
      <p class="lock-codigo-titulo">código de recuperação</p>
      <p class="lock-codigo-valor">${escapeHtml(codigo)}</p>
      <p class="lock-codigo-aviso">anote ou baixe agora — ele <strong>não aparece de novo</strong>. é o único jeito de trocar o PIN se você esquecer.</p>
      <div class="lock-codigo-acoes">
        <button type="button" class="btn sm" data-codigo-acao="copiar">copiar</button>
        <button type="button" class="btn sm" data-codigo-acao="baixar">baixar .txt</button>
      </div>
      <p class="lock-codigo-status" aria-live="polite"></p>
    </div>`;
}

export function wireCodigoRecuperacao(root) {
  const box = root.querySelector(".lock-codigo");
  if (!box) return;
  const codigo = box.dataset.codigo;
  const status = box.querySelector(".lock-codigo-status");
  box.querySelector('[data-codigo-acao="copiar"]').addEventListener("click", async () => {
    status.textContent = (await copyText(codigo)) ? "copiado" : "não deu pra copiar — anote à mão";
  });
  box.querySelector('[data-codigo-acao="baixar"]').addEventListener("click", () => {
    const texto = `Kami — código de recuperação do PIN\n\n${codigo}\n\nUse em "esqueci o PIN", na tela de bloqueio. Guarde num lugar seguro.\n`;
    const url = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "kami-codigo-de-recuperacao.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.textContent = "salvo na pasta de downloads";
  });
}

// ── tela ───────────────────────────────────────────────────────────────

function pinPadHtml() {
  const teclas = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "apagar", "0", "ok"];
  return `<div class="lock-pad">${teclas
    .map((t) => {
      if (t === "apagar") return `<button type="button" class="lock-key" data-key="apagar" aria-label="apagar">⌫</button>`;
      if (t === "ok") return `<button type="button" class="lock-key lock-key--ok" data-key="ok">ok</button>`;
      return `<button type="button" class="lock-key" data-key="${t}">${t}</button>`;
    })
    .join("")}</div>`;
}

function viewPin() {
  return `
    <div class="lock-view" data-view="pin">
      <p class="lock-prompt" id="lock-title">&gt; digite o PIN<span class="lock-cursor">_</span></p>
      <input class="lock-input" id="lock-pin" type="password" inputmode="numeric" autocomplete="off"
             maxlength="${PIN_MAX}" aria-labelledby="lock-title" spellcheck="false">
      ${pinPadHtml()}
      <p class="lock-msg" aria-live="polite"></p>
      <button type="button" class="lock-link" data-ir="recuperar">esqueci o PIN</button>
    </div>`;
}

function viewRecuperar(pasta) {
  return `
    <div class="lock-view" data-view="recuperar" hidden>
      <p class="lock-prompt">&gt; código de recuperação<span class="lock-cursor">_</span></p>
      <p class="lock-desc">é o código <code>KAMI-…</code> mostrado quando o PIN foi ligado.</p>
      <div class="field"><label for="lock-codigo">código</label>
        <input type="text" id="lock-codigo" autocomplete="off" spellcheck="false" maxlength="40" placeholder="KAMI-XXXX-XXXX-XXXX"></div>
      <div class="field"><label for="lock-novo">PIN novo (${PIN_MIN} a ${PIN_MAX} dígitos)</label>
        <input type="password" id="lock-novo" inputmode="numeric" autocomplete="off" maxlength="${PIN_MAX}"></div>
      <div class="field"><label for="lock-novo2">repita o PIN novo</label>
        <input type="password" id="lock-novo2" inputmode="numeric" autocomplete="off" maxlength="${PIN_MAX}"></div>
      <div class="form-actions">
        <button type="button" class="btn sm" data-acao="recuperar">trocar o PIN</button>
        <button type="button" class="btn sm" data-ir="pin">voltar</button>
      </div>
      <p class="lock-msg" aria-live="polite"></p>
      <details class="lock-sem-codigo">
        <summary>não tenho o código</summary>
        <p>feche o kami e apague o arquivo <code>pin.json</code> da pasta de dados:</p>
        <p><code class="lock-pasta">${escapeHtml(pasta || "")}</code></p>
        <p>na próxima abertura o kami abre sem PIN. seus dados continuam intactos — o PIN protege a abertura do app, não cifra o banco.</p>
      </details>
    </div>
    <div class="lock-view" data-view="novo-codigo" hidden>
      <p class="lock-prompt">&gt; PIN trocado<span class="lock-cursor">_</span></p>
      <div class="lock-novo-codigo"></div>
      <div class="form-actions"><button type="button" class="btn sm" data-acao="guardei">guardei o código, continuar</button></div>
    </div>`;
}

function setMsg(view, texto, erro = true) {
  const el = view.querySelector(".lock-msg");
  el.textContent = texto;
  el.classList.toggle("lock-msg--erro", erro);
}

function mostrarView(root, nome) {
  root.querySelectorAll(".lock-view").forEach((v) => {
    v.hidden = v.dataset.view !== nome;
  });
  const foco = { pin: "#lock-pin", recuperar: "#lock-codigo", "novo-codigo": '[data-acao="guardei"]' }[nome];
  root.querySelector(foco)?.focus();
}

function travarResto(sim) {
  document.querySelectorAll("body > *").forEach((el) => {
    if (el.classList.contains("lock-screen") || el.classList.contains("titlebar")) return;
    if (sim) {
      if (!el.inert) {
        el.inert = true;
        el.dataset.lockInert = "1";
      }
    } else if (el.dataset.lockInert) {
      el.inert = false;
      delete el.dataset.lockInert;
    }
  });
}

let esperaTimer = null;

function aplicarEspera(view, segundos, campos) {
  clearInterval(esperaTimer);
  let resta = segundos;
  const tick = () => {
    if (resta <= 0) {
      clearInterval(esperaTimer);
      campos.forEach((c) => (c.disabled = false));
      setMsg(view, "pode tentar de novo", false);
      campos[0]?.focus();
      return;
    }
    campos.forEach((c) => (c.disabled = true));
    setMsg(view, `muitas tentativas erradas — espere ${resta} s`);
    resta -= 1;
  };
  tick();
  esperaTimer = setInterval(tick, 1000);
}

function erroEhEspera(err) {
  return err instanceof ApiError && err.status === 429;
}

function segundosDaEspera(err) {
  const m = /(\d+)\s*s/.exec(err.message || "");
  return m ? Number(m[1]) : 30;
}

function fechar() {
  if (!aberta) return;
  clearInterval(esperaTimer);
  const { el, resolve, recarregar } = aberta;
  aberta = null;
  travarResto(false);
  el.remove();
  ultimaAtividade = Date.now();
  if (recarregar) {
    window.location.reload();
    return;
  }
  resolve();
}

function abrir({ estado, recarregar = false }) {
  if (aberta) {
    aberta.recarregar = aberta.recarregar || recarregar;
    return aberta.promise;
  }
  const el = document.createElement("div");
  el.className = "lock-screen";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "lock-title");
  el.innerHTML = `
    <div class="lock-box">
      <p class="lock-brand">kami <span class="lock-brand-tag">${icon("shield", { size: 12 })} bloqueado</span></p>
      ${viewPin()}
      ${viewRecuperar(estado?.pasta)}
      <p class="lock-nota">o PIN protege a abertura do app — não cifra os seus dados.</p>
    </div>`;
  document.body.appendChild(el);

  let resolve;
  const promise = new Promise((r) => (resolve = r));
  aberta = { el, resolve, recarregar, promise };
  travarResto(true);
  wireTela(el);
  mostrarView(el, "pin");
  if (estado?.espera_s) {
    const view = el.querySelector('[data-view="pin"]');
    aplicarEspera(view, estado.espera_s, [view.querySelector("#lock-pin"), ...view.querySelectorAll(".lock-key")]);
  }
  return promise;
}

function wireTela(root) {
  const viewP = root.querySelector('[data-view="pin"]');
  const input = viewP.querySelector("#lock-pin");
  const camposPin = () => [input, ...viewP.querySelectorAll(".lock-key")];

  const enviar = async () => {
    const valor = input.value;
    if (valor.length < PIN_MIN) {
      setMsg(viewP, `o PIN tem de ${PIN_MIN} a ${PIN_MAX} dígitos`);
      input.focus();
      return;
    }
    camposPin().forEach((c) => (c.disabled = true));
    setMsg(viewP, "conferindo…", false);
    try {
      await desbloquearPin(valor);
      fechar();
    } catch (err) {
      input.value = "";
      camposPin().forEach((c) => (c.disabled = false));
      if (erroEhEspera(err)) aplicarEspera(viewP, segundosDaEspera(err), camposPin());
      else setMsg(viewP, err instanceof ApiError && err.status === 422 ? "PIN errado" : `não deu pra conferir: ${err.message}`);
      if (!input.disabled) input.focus();
    }
  };

  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^0-9]/g, "").slice(0, PIN_MAX);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      enviar();
    }
  });
  viewP.querySelector(".lock-pad").addEventListener("click", (e) => {
    const key = e.target.closest(".lock-key")?.dataset.key;
    if (!key) return;
    if (key === "ok") enviar();
    else if (key === "apagar") input.value = input.value.slice(0, -1);
    else if (input.value.length < PIN_MAX) input.value += key;
    if (key !== "ok") input.focus();
  });

  root.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => mostrarView(root, b.dataset.ir)));

  const viewR = root.querySelector('[data-view="recuperar"]');
  viewR.querySelector('[data-acao="recuperar"]').addEventListener("click", async () => {
    const codigo = viewR.querySelector("#lock-codigo").value.trim();
    const novo = viewR.querySelector("#lock-novo").value;
    const novo2 = viewR.querySelector("#lock-novo2").value;
    if (!codigo) return setMsg(viewR, "digite o código de recuperação");
    if (!/^[0-9]{4,8}$/.test(novo)) return setMsg(viewR, `o PIN novo tem de ${PIN_MIN} a ${PIN_MAX} dígitos (só números)`);
    if (novo !== novo2) return setMsg(viewR, "os dois PINs não são iguais");
    const campos = [...viewR.querySelectorAll("input, button")];
    campos.forEach((c) => (c.disabled = true));
    setMsg(viewR, "conferindo…", false);
    try {
      const res = await recuperarPin(codigo, novo);
      const box = root.querySelector(".lock-novo-codigo");
      box.innerHTML = codigoRecuperacaoHtml(res.codigo_recuperacao);
      wireCodigoRecuperacao(box);
      mostrarView(root, "novo-codigo");
    } catch (err) {
      campos.forEach((c) => (c.disabled = false));
      if (erroEhEspera(err)) aplicarEspera(viewR, segundosDaEspera(err), campos);
      else setMsg(viewR, err.message);
    }
  });
  root.querySelector('[data-acao="guardei"]').addEventListener("click", fechar);
}

// ── API pública ────────────────────────────────────────────────────────

export async function garantirDesbloqueio() {
  let estado;
  try {
    estado = await getPin();
  } catch {
    return; // sem backend: o vigia mostra a faixa; um 423 depois reabre esta tela
  }
  inatividadeMin = estado.inatividade_min ?? null;
  if (estado.ativo && estado.bloqueado) await abrir({ estado });
}

/** "bloquear agora" (configurações › segurança): ao desbloquear, a tela fica como estava. */
export async function bloquearAgora() {
  const estado = await bloquearPin();
  if (estado.bloqueado) await abrir({ estado });
}

export function wireLockScreen() {
  window.addEventListener("kami:bloqueado", async () => {
    if (aberta) return;
    let estado = null;
    try {
      estado = await getPin();
    } catch {
      // segue com a tela mesmo sem o estado (sem a pasta no "não tenho o código")
    }
    abrir({ estado, recarregar: true });
  });
}

function marcarAtividade() {
  if (!aberta) ultimaAtividade = Date.now();
}

async function conferirInatividade() {
  if (aberta || !inatividadeMin) return;
  if (Date.now() - ultimaAtividade < inatividadeMin * 60_000) return;
  try {
    const estado = await bloquearPin();
    if (estado.bloqueado) abrir({ estado });
  } catch {
    // sem backend agora: tenta de novo no próximo tick
  }
}

export function startInactivityLock() {
  ATIVIDADE.forEach((ev) => window.addEventListener(ev, marcarAtividade, { passive: true, capture: true }));
  clearInterval(inatividadeTimer);
  inatividadeTimer = setInterval(conferirInatividade, 15_000);
  // configurações › segurança avisa quando o tempo muda (ou o PIN liga/desliga)
  window.addEventListener("kami:pin-config", (e) => {
    inatividadeMin = e.detail?.ativo ? (e.detail.inatividade_min ?? null) : null;
    ultimaAtividade = Date.now();
  });
}

export function _resetLockScreenForTests() {
  if (aberta && typeof document !== "undefined") {
    aberta.el.remove();
    travarResto(false);
  }
  aberta = null;
  inatividadeMin = null;
  clearInterval(esperaTimer);
  clearInterval(inatividadeTimer);
}

export const _conferirInatividadeForTests = conferirInatividade;
export const _setUltimaAtividadeForTests = (t) => (ultimaAtividade = t);
