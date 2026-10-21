import { icon } from "../components/icons.js";
import { getEmail, markEmailRead, markEmailUnread } from "../api/organizacao.js";
import { renderEmailTexto, textoParaCopiar, dataLonga } from "../components/email-texto.js";
import { openExternal } from "../components/open-external.js";
import { copyText } from "../components/clipboard.js";
import { showToast } from "../components/toast.js";

/**
 * modals/email-leitor-modal.js — leitor de e-mail dentro do app (ORG-06).
 *
 * Antes o clique num e-mail abria um modal com a prévia de 280
 * caracteres; pra ler o resto só abrindo o webmail. Agora:
 *   - texto completo, limpo no backend (app/email_texto.py) e desenhado
 *     com textContent (components/email-texto.js) — nada de HTML de
 *     terceiro, nem imagem baixada;
 *   - cabeçalho com assunto, remetente (nome em destaque, endereço
 *     menor), conta e data por extenso;
 *   - ações: abrir no webmail (no Gmail, o próprio e-mail), marcar como
 *     não lido, copiar o texto;
 *   - anterior/próximo (botões ou ← →) percorrendo a lista na ordem e
 *     no filtro que estavam na tela — dá pra ler a caixa inteira sem
 *     fechar o leitor.
 *
 * Mesmo padrão singleton dos outros modais (DOM construído uma vez). O
 * botão de fechar usa data-action="close" — Esc fecha pelo
 * modal-escape.js, sem código aqui.
 *
 * Uso (pages/organizacao.js):
 *   openEmailLeitor({
 *     ids,                 // ids na ordem da lista visível
 *     index,               // qual abrir
 *     resumo: (id) => e,   // item da lista (assunto, remetente, is_read…)
 *     conta: (accountId) => ({ label, color }),
 *     onLido: (id, lido) => …,  // a tela atualiza a lista e o sino
 *   });
 */

let modalEl = null;
let ctx = null;
// cada abertura pede o texto ao backend; se a pessoa passar rápido por
// vários e-mails (← → seguidos), só a resposta do último vale
let pedido = 0;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "email-leitor-modal";
  wrap.innerHTML = `
    <div class="modal wide em-leitor" role="dialog" aria-modal="true" aria-labelledby="eml-assunto">
      <div class="modal-head">
        <span class="eml-titulo">${icon("mail", { size: 12 })} e-mail <span class="eml-pos" id="eml-pos"></span></span>
        <span class="eml-nav">
          <button type="button" class="eml-nav-btn" data-eml="anterior" aria-label="e-mail anterior" data-tooltip="anterior (←)">${icon("chevron-left", { size: 14 })}</button>
          <button type="button" class="eml-nav-btn" data-eml="proximo" aria-label="próximo e-mail" data-tooltip="próximo (→)">${icon("chevron-right", { size: 14 })}</button>
        </span>
        <button type="button" class="close" data-action="close" aria-label="fechar">${icon("x")}</button>
      </div>
      <div class="eml-cabecalho">
        <h2 class="eml-assunto" id="eml-assunto"></h2>
        <div class="eml-de">
          <span class="email-avatar eml-avatar" id="eml-avatar"></span>
          <span class="eml-de-texto">
            <span class="eml-nome" id="eml-nome"></span>
            <span class="eml-endereco" id="eml-endereco"></span>
          </span>
          <span class="eml-quando">
            <span id="eml-data"></span>
            <span class="eml-conta" id="eml-conta"></span>
          </span>
        </div>
        <div class="eml-acoes">
          <button type="button" class="btn sm" data-eml="webmail" id="eml-webmail">${icon("external-link", { size: 11 })} abrir no webmail</button>
          <button type="button" class="btn sm" data-eml="nao-lido">${icon("mail", { size: 11 })} marcar como não lido</button>
          <button type="button" class="btn sm" data-eml="copiar">${icon("copy", { size: 11 })} copiar texto</button>
        </div>
      </div>
      <div class="eml-corpo" id="eml-corpo" tabindex="0" aria-label="texto do e-mail"></div>
      <div class="eml-rodape" aria-hidden="true">← → navegar · esc fechar</div>
    </div>
  `;
  document.body.appendChild(wrap);

  wrap.querySelector('[data-action="close"]').addEventListener("click", close);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) return close();
    const link = e.target.closest(".em-link");
    if (link) {
      e.preventDefault();
      openExternal(link.dataset.url);
      return;
    }
    const acao = e.target.closest("[data-eml]")?.dataset.eml;
    if (acao === "anterior") mostrar(ctx.index - 1);
    if (acao === "proximo") mostrar(ctx.index + 1);
    if (acao === "webmail" && ctx.detalhe?.webmail_url) openExternal(ctx.detalhe.webmail_url);
    if (acao === "nao-lido") marcarNaoLido();
    if (acao === "copiar") copiar();
  });
  return wrap;
}

function onKeydown(e) {
  if (!modalEl?.classList.contains("open") || e.altKey || e.ctrlKey || e.metaKey) return;
  // outro modal por cima (ex.: confirmação) — as setas são dele
  const abertos = document.querySelectorAll(".modal-backdrop.open");
  if (abertos[abertos.length - 1] !== modalEl) return;
  if (e.key === "ArrowLeft" || e.key === "k") {
    e.preventDefault();
    mostrar(ctx.index - 1);
  } else if (e.key === "ArrowRight" || e.key === "j") {
    e.preventDefault();
    mostrar(ctx.index + 1);
  }
}

function close() {
  modalEl?.classList.remove("open");
  document.removeEventListener("keydown", onKeydown);
  ctx = null;
}

function preencherCabecalho(resumo) {
  const $ = (id) => modalEl.querySelector(id);
  const conta = ctx.conta(resumo.account_id) || {};
  $("#eml-assunto").textContent = resumo.subject || "(sem assunto)";
  $("#eml-nome").textContent = resumo.sender_name || resumo.sender || "?";
  $("#eml-endereco").textContent = resumo.sender_email && resumo.sender_email !== resumo.sender_name ? resumo.sender_email : "";
  const avatar = $("#eml-avatar");
  avatar.textContent = (resumo.sender_name || resumo.sender || "?").trim().charAt(0).toUpperCase() || "?";
  avatar.style.setProperty("--chip-color", conta.color || "var(--accent)");
  $("#eml-data").textContent = dataLonga(resumo.received_at);
  $("#eml-conta").textContent = conta.label ? `conta: ${conta.label}` : "";
  $("#eml-conta").style.setProperty("--chip-color", conta.color || "var(--accent)");
  $("#eml-pos").textContent = ctx.ids.length > 1 ? `${ctx.index + 1}/${ctx.ids.length}` : "";
  modalEl.querySelector('[data-eml="anterior"]').disabled = ctx.index <= 0;
  modalEl.querySelector('[data-eml="proximo"]').disabled = ctx.index >= ctx.ids.length - 1;
}

async function mostrar(index) {
  if (!ctx || index < 0 || index >= ctx.ids.length) return;
  ctx.index = index;
  ctx.detalhe = null;
  const id = ctx.ids[index];
  const resumo = ctx.resumo(id);
  if (!resumo) return;
  preencherCabecalho(resumo);

  const corpo = modalEl.querySelector("#eml-corpo");
  corpo.replaceChildren();
  corpo.classList.add("carregando");
  corpo.textContent = "carregando…";
  corpo.scrollTop = 0;
  modalEl.querySelector("#eml-webmail").hidden = true;

  const meu = ++pedido;
  let detalhe;
  try {
    detalhe = await getEmail(id);
  } catch (err) {
    if (meu !== pedido || !ctx) return;
    corpo.classList.remove("carregando");
    corpo.textContent = "não foi possível carregar este e-mail.";
    return;
  }
  if (meu !== pedido || !ctx) return;
  ctx.detalhe = detalhe;

  corpo.classList.remove("carregando");
  corpo.replaceChildren();
  if (detalhe.body_text) {
    corpo.append(renderEmailTexto(detalhe.body_text));
  } else {
    const vazio = document.createElement("p");
    vazio.className = "eml-vazio";
    vazio.textContent = "este e-mail não tem texto (só imagem ou anexo).";
    corpo.append(vazio);
  }
  if (detalhe.body_cortado) {
    const aviso = document.createElement("p");
    aviso.className = "eml-aviso";
    aviso.textContent = detalhe.webmail_url
      ? "─ o texto completo não está guardado no kami (e-mail longo ou antigo) — abra no webmail pra ver tudo."
      : "─ o texto completo não está guardado no kami (e-mail longo ou antigo).";
    corpo.append(aviso);
  }
  modalEl.querySelector("#eml-webmail").hidden = !detalhe.webmail_url;

  if (!resumo.is_read) {
    markEmailRead(id)
      .then(() => ctx?.onLido?.(id, true))
      .catch((err) => console.error("falha ao marcar e-mail como lido:", err));
  }
}

async function marcarNaoLido() {
  if (!ctx) return;
  const id = ctx.ids[ctx.index];
  const onLido = ctx.onLido;
  try {
    await markEmailUnread(id);
  } catch {
    return; // o client já mostrou o erro (CONF-01)
  }
  close();
  onLido?.(id, false);
  showToast({ title: "marcado como não lido", iconName: "mail", duration: 3000, sound: false });
}

async function copiar() {
  const texto = ctx?.detalhe?.body_text;
  if (!texto) return;
  const ok = await copyText(textoParaCopiar(texto));
  showToast(
    ok
      ? { title: "texto copiado", iconName: "copy", duration: 3000, sound: false }
      : { title: "não foi possível copiar", variant: "erro" }
  );
}

/**
 * @param {{ ids: string[], index: number, resumo: (id: string) => object,
 *   conta: (accountId: string) => ({label?: string, color?: string}),
 *   onLido?: (id: string, lido: boolean) => void }} opts
 */
export function openEmailLeitor(opts) {
  modalEl = modalEl && modalEl.isConnected ? modalEl : buildModal();
  ctx = { ...opts, detalhe: null };
  modalEl.classList.add("open");
  document.removeEventListener("keydown", onKeydown);
  document.addEventListener("keydown", onKeydown);
  mostrar(opts.index);
  modalEl.querySelector("#eml-corpo").focus({ preventScroll: true });
}

export function closeEmailLeitor() {
  close();
}
