/**
 * Passo a passo de conexão do assistente (IA-04, P-116..P-119), dentro
 * da aba configurações › assistente.
 *
 *   caminhos  →  provedores do caminho  →  ficha do provedor
 *   (paga / gratuita / no computador)       (o que é, quanto custa, seus
 *                                             dados, passos, links)
 *
 * "usar este" abre o formulário de provedor já com o catálogo escolhido
 * (quem chama passa `onUsar`). Escrito pra quem nunca mexeu com isso e
 * pra não envelhecer:
 * - nenhum número de limite (P-118): mudam o tempo todo; o texto aponta
 *   pro painel do provedor e o Kami tem o teto diário dele;
 * - descreve o caminho, não o botão exato da tela do provedor;
 * - os rótulos dos botões do Kami entram por variável ({usar_este}…), pra
 *   cada idioma citar exatamente o que aparece na tela;
 * - os links oficiais vêm do catálogo (backend/app/assistente/provedores.json),
 *   os textos dos dicionários (assistente.guia.*).
 */
import { escapeHtml } from "../../components/format.js";
import { icon } from "../../components/icons.js";
import { t, tOu } from "../../i18n.js";

const CAMINHOS = ["paga", "gratuita", "local"];

// ordem dentro de cada caminho (P-117); "outro" sempre por último
const ORDEM = {
  paga: ["openai", "anthropic", "gemini", "openrouter"],
  gratuita: ["gemini", "groq", "openrouter"],
  local: ["ollama", "lmstudio"],
};

const LINKS = ["chave", "docs", "precos", "privacidade", "privacidade_conta", "baixar", "modelos"];

let estado = { caminho: null, id: null };

function passos(id, caminho) {
  if (id === "ollama") return ["instalar", "ollama_modelo", "ollama_aberto", "local_usar"];
  if (id === "lmstudio") return ["instalar", "lms_modelo", "lms_servidor", "local_usar"];
  if (id === "outro") return ["outro_endereco", "testar"];
  return ["conta", ...(caminho === "paga" ? ["pagamento"] : []), "chave",
    id === "openrouter" && caminho === "gratuita" ? "colar_gratis" : "colar", "testar"];
}

/** Rótulos dos botões citados nos passos — os mesmos da tela. */
function rotulos() {
  return {
    criar_chave: t("assistente.guia.link.chave"),
    baixar: t("assistente.guia.link.baixar"),
    modelos: t("assistente.guia.link.modelos"),
    privacidade_conta: t("assistente.guia.link.privacidade_conta"),
    usar_este: t("assistente.guia.usar_este"),
    buscar: t("assistente.buscar_modelos"),
    so_gratis: t("assistente.so_gratuitos"),
    salvar_testar: t("assistente.salvar_e_testar"),
  };
}

/** Texto do provedor: a versão do caminho (custo_gratuita) se existir. */
function texto(id, campo, caminho) {
  const vars = rotulos();
  return tOu(`assistente.guia.p.${id}.${campo}_${caminho}`, tOu(`assistente.guia.p.${id}.${campo}`, "", vars), vars);
}

function provedoresDo(caminho, catalogo) {
  const ids = [...ORDEM[caminho], "outro"];
  return ids.map((id) => catalogo.find((c) => c.id === id && (c.caminhos || []).includes(caminho))).filter(Boolean);
}

function nomeDe(c) {
  return c.id === "outro" ? t("assistente.outro_compativel") : c.nome;
}

function htmlCaminhos() {
  return `
    <h5 class="cfg-subhead" tabindex="-1">${escapeHtml(t("assistente.guia.titulo"))}</h5>
    <p class="settings-desc">${escapeHtml(t("assistente.guia.intro"))}</p>
    <div class="cfg-ia-guia-opcoes">
      ${CAMINHOS.map((c) => `
      <button type="button" class="cfg-ia-guia-opcao" data-guia="caminho" data-valor="${c}">
        <b>${escapeHtml(t(`assistente.guia.caminho.${c}`))}</b>
        <span>${escapeHtml(t(`assistente.guia.caminho.${c}_desc`))}</span>
      </button>`).join("")}
    </div>
    <div class="form-actions">
      <button type="button" class="btn sm" data-guia="sair">${escapeHtml(t("assistente.guia.fechar"))}</button>
    </div>`;
}

function htmlProvedores(catalogo) {
  const caminho = estado.caminho;
  return `
    <h5 class="cfg-subhead" tabindex="-1">${escapeHtml(t(`assistente.guia.caminho.${caminho}`))}</h5>
    <p class="settings-desc">${escapeHtml(t("assistente.guia.escolha_provedor"))}</p>
    <div class="cfg-ia-guia-opcoes">
      ${provedoresDo(caminho, catalogo).map((c) => `
      <button type="button" class="cfg-ia-guia-opcao" data-guia="provedor" data-valor="${escapeHtml(c.id)}">
        <b>${escapeHtml(nomeDe(c))}</b>
        <span>${escapeHtml(texto(c.id, "o_que", caminho))}</span>
      </button>`).join("")}
    </div>
    <div class="form-actions">
      <button type="button" class="btn sm" data-guia="voltar">${escapeHtml(t("assistente.guia.voltar"))}</button>
    </div>`;
}

function htmlFicha(catalogo) {
  const { caminho, id } = estado;
  const c = catalogo.find((x) => x.id === id);
  const local = caminho === "local" && id !== "outro";
  const secao = (titulo, corpo, classe = "") => corpo
    ? `<div class="cfg-ia-guia-item${classe}"><b>${escapeHtml(t(titulo))}</b><p>${escapeHtml(corpo)}</p></div>`
    : "";
  const vars = rotulos();
  const links = LINKS.filter((k) => c.links?.[k]).map((k) =>
    `<span class="cfg-ia-link" role="link" tabindex="0" data-open-link="${escapeHtml(c.links[k])}">${escapeHtml(t(`assistente.guia.link.${k}`))}</span>`);
  return `
    <h5 class="cfg-subhead" tabindex="-1">${escapeHtml(nomeDe(c))}</h5>
    ${secao("assistente.guia.o_que_e", texto(id, "o_que", caminho))}
    ${secao("assistente.guia.custo", local ? t("assistente.guia.local_custo") : texto(id, "custo", caminho))}
    ${secao("assistente.guia.dados", local ? t("assistente.guia.local_dados") : texto(id, "dados", caminho), local ? "" : " cfg-ia-guia-item--dados")}
    ${local ? secao("assistente.guia.requisitos", t("assistente.guia.local_requisitos")) : ""}
    <div class="cfg-ia-guia-item">
      <b>${escapeHtml(t("assistente.guia.passos"))}</b>
      <ol class="cfg-ia-guia-passos">${passos(id, caminho).map((p) => `<li>${escapeHtml(t(`assistente.guia.passo.${p}`, vars))}</li>`).join("")}</ol>
    </div>
    ${links.length ? `<p class="settings-note">${escapeHtml(t("assistente.guia.links"))}: ${links.join(" · ")}</p>` : ""}
    <div class="form-actions">
      <button type="button" class="btn sm primary" data-guia="usar">${icon("check", { size: 12 })} ${escapeHtml(t("assistente.guia.usar_este"))}</button>
      <button type="button" class="btn sm" data-guia="voltar">${escapeHtml(t("assistente.guia.voltar"))}</button>
    </div>
    <p class="settings-note">${escapeHtml(t("assistente.guia.usar_dica"))}</p>`;
}

function render(box, catalogo) {
  box.innerHTML = estado.id ? htmlFicha(catalogo) : estado.caminho ? htmlProvedores(catalogo) : htmlCaminhos();
  box.querySelector(".cfg-subhead")?.focus();
}

/**
 * Abre o passo a passo em `box` (começa pelos caminhos).
 * `onUsar(catalogoId)`: "usar este"; `onFechar()`: fechar.
 */
export function abrirGuia(box, catalogo, { onUsar, onFechar }) {
  estado = { caminho: null, id: null };
  box.hidden = false;
  render(box, catalogo);
  if (box.dataset.ligado) {
    box._guia = { catalogo, onUsar, onFechar };
    return;
  }
  box.dataset.ligado = "1";
  box._guia = { catalogo, onUsar, onFechar };
  box.addEventListener("click", (e) => {
    const alvo = e.target.closest("[data-guia]");
    if (!alvo) return;
    const { catalogo: cat, onUsar: usar, onFechar: fechar } = box._guia;
    const acao = alvo.dataset.guia;
    if (acao === "caminho") estado = { caminho: alvo.dataset.valor, id: null };
    else if (acao === "provedor") estado = { ...estado, id: alvo.dataset.valor };
    else if (acao === "voltar") estado = estado.id ? { ...estado, id: null } : { caminho: null, id: null };
    else if (acao === "usar") return usar(estado.id);
    else if (acao === "sair") return fechar();
    render(box, cat);
  });
  box.addEventListener("keydown", (e) => {
    const link = e.target.closest(".cfg-ia-link");
    if (link && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      link.click();
    }
  });
}

export function fecharGuia(box) {
  if (!box) return;
  box.innerHTML = "";
  box.hidden = true;
}
