/**
 * Seção "cópias automáticas" da aba backup das configurações (CONF-08):
 * a lista de cópias da pasta de backups (semanais, de antes de uma ação
 * grande e de antes de atualizar), "copiar agora", restaurar uma cópia e
 * a pasta extra (pendrive, HD externo, pasta sincronizada).
 * A regra mora no backend (app/backup_auto.py).
 */
import { copiarAgora, definirPastaExtra, getBackups, restaurarCopia } from "../../api/backups.js";
import { escapeHtml, fmtDataHora } from "../../components/format.js";
import { icon } from "../../components/icons.js";
import { showConfirmModal } from "../confirm-modal.js";
import { showErrorModal } from "../err-modal.js";
import { estado } from "./estado.js";
import { t } from "../../i18n.js";

const acoes = () => ({
  importar: t("copias.antes_de_importar"),
  "apagar-tudo": t("copias.antes_de_apagar_tudo"),
  "redefinir-chave": t("copias.antes_de_redefinir_a_chave"),
  atualizar: t("copias.antes_de_atualizar_o_app"),
  restaurar: t("copias.antes_de_restaurar"),
});

export function copiasSectionHtml() {
  return `
      <div class="settings-section" id="cfg-copias">
        <h4>${t("copias.copias_automaticas")}</h4>
        <p class="settings-desc">${t("copias.o_kami_guarda_sozinho_uma")}</p>
        <p class="settings-note">${t("copias.nota_disco")}</p>
        <ul class="cfg-copias-lista" id="cfg-copias-lista"><li class="settings-desc">${t("geral.carregando")}</li></ul>
        <div class="form-actions">
          <button class="btn sm" id="cfg-copias-agora">${t("copias.fazer_uma_copia_agora")}</button>
        </div>
        <p class="settings-status" id="cfg-copias-status"></p>
        <div class="field">
          <label for="cfg-copias-pasta">${t("copias.pasta_extra_opcional_pendrive_hd")}</label>
          <input type="text" id="cfg-copias-pasta" placeholder="${t("copias.ex_media_pendrive_kami_ou")}" autocomplete="off" spellcheck="false" maxlength="1000">
        </div>
        <p class="settings-note">${t("copias.nota_pasta")}</p>
        <div class="form-actions">
          <button class="btn sm" id="cfg-copias-pasta-escolher" hidden>${t("copias.escolher_pasta")}</button>
          <button class="btn sm" id="cfg-copias-pasta-salvar">${t("copias.usar_esta_pasta")}</button>
          <button class="btn sm" id="cfg-copias-pasta-tirar" hidden>${t("copias.parar_de_copiar_pra_la")}</button>
        </div>
        <p class="settings-status" id="cfg-copias-pasta-status"></p>
      </div>`;
}

function tamanho(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function descricao(c) {
  if (c.tipo === "semanal") return t("copias.semanal");
  if (c.tipo === "atualizacao") return escapeHtml(t("copias.antes_versao", { versao: c.acao || t("copias.versao_nova") }));
  return escapeHtml(acoes()[c.acao] || t("copias.antes_de", { acao: c.acao }));
}

function status(wrap, id, html, erro = false) {
  const el = wrap.querySelector(id);
  el.innerHTML = html;
  el.classList.add("settings-status--visible");
  el.classList.toggle("settings-status--erro", erro);
}

function render(wrap, dados) {
  const lista = wrap.querySelector("#cfg-copias-lista");
  lista.innerHTML = dados.copias.length
    ? dados.copias
        .map(
          (c) => `<li>
            <span class="cfg-copias-quando">${escapeHtml(fmtDataHora(c.quando))}</span>
            <span class="cfg-copias-tipo">${descricao(c)} · ${tamanho(c.tamanho)}</span>
            <button type="button" class="btn sm" data-restaurar="${escapeHtml(c.nome)}" data-quando="${escapeHtml(fmtDataHora(c.quando))}">${t("copias.restaurar")}</button>
          </li>`
        )
        .join("")
    : `<li class="settings-desc">${t("copias.nenhuma_copia_ainda_a_primeira")}</li>`;

  const input = wrap.querySelector("#cfg-copias-pasta");
  if (document.activeElement !== input) input.value = dados.pasta_extra || "";
  wrap.querySelector("#cfg-copias-pasta-tirar").hidden = !dados.pasta_extra;
  const pastaStatus = wrap.querySelector("#cfg-copias-pasta-status");
  if (!dados.pasta_extra) {
    pastaStatus.textContent = "";
    pastaStatus.classList.remove("settings-status--visible", "settings-status--erro");
  } else if (dados.extra_erro) {
    status(
      wrap,
      "#cfg-copias-pasta-status",
      `<span class="cfg-seg-warn">[!]</span> ${escapeHtml(t("copias.pasta_indisponivel", { ultima: dados.extra_ok_em ? t("copias.ultima_la_traco", { quando: fmtDataHora(dados.extra_ok_em) }) : "" }))}`,
      dados.extra_atrasada
    );
  } else {
    status(wrap, "#cfg-copias-pasta-status", `${icon("check", { size: 12 })} ${escapeHtml(t("copias.ultima_la", { quando: fmtDataHora(dados.extra_ok_em) }))}`);
  }
}

// Cada pedido da lista ganha um número e só o mais recente desenha: abrir a
// aba pede a lista mais de uma vez, e uma resposta atrasada redesenhava a
// lista velha por cima da de "copiar agora" (achado no e2e da 1.14)
let pedido = 0;
async function desenharDepois(wrap, promessa) {
  const meu = ++pedido;
  const dados = await promessa;
  if (meu === pedido) render(wrap, dados);
}

export async function carregarCopias(wrap) {
  try {
    await desenharDepois(wrap, getBackups());
  } catch (err) {
    wrap.querySelector("#cfg-copias-lista").innerHTML = `<li class="settings-desc">${escapeHtml(t("copias.erro_listar", { erro: err.message }))}</li>`;
  }
}

async function salvarPasta(wrap, pasta) {
  if (estado.busy) return;
  estado.busy = true;
  try {
    await desenharDepois(wrap, definirPastaExtra(pasta));
    if (pasta) status(wrap, "#cfg-copias-pasta-status", `${icon("check", { size: 12 })} ${t("copias.pasta_salva")}`);
  } catch (err) {
    status(wrap, "#cfg-copias-pasta-status", escapeHtml(err.message), true);
  } finally {
    estado.busy = false;
  }
}

async function restaurar(wrap, nome, quando) {
  if (estado.busy) return;
  const sim = await showConfirmModal(
    t("copias.restaurar_confirma", { quando }),
    { title: t("copias.restaurar_copia"), confirmText: t("copias.sim_restaurar"), danger: true }
  );
  if (!sim) return;
  estado.busy = true;
  try {
    await restaurarCopia(nome);
    window.location.reload();
  } catch (err) {
    estado.busy = false;
    showErrorModal(err.message, t("copias.nao_deu_pra_restaurar_a"));
  }
}

/**
 * Seletor de pasta do sistema (tauri-plugin-dialog, só a permissão
 * dialog:allow-open). Só existe no app instalado — no navegador de dev o
 * botão fica escondido e o caminho é digitado.
 */
async function escolherPasta(wrap) {
  try {
    const pasta = await window.__TAURI__.core.invoke("plugin:dialog|open", {
      options: { directory: true, multiple: false, title: t("copias.pasta_extra_das_copias_do") },
    });
    if (!pasta) return; // cancelou
    wrap.querySelector("#cfg-copias-pasta").value = pasta;
    salvarPasta(wrap, pasta);
  } catch (err) {
    status(wrap, "#cfg-copias-pasta-status", escapeHtml(t("copias.erro_seletor", { erro: String(err) })), true);
  }
}

export function wireCopias(wrap) {
  const escolher = wrap.querySelector("#cfg-copias-pasta-escolher");
  if (window.__TAURI__?.core?.invoke) {
    escolher.hidden = false;
    escolher.addEventListener("click", () => escolherPasta(wrap));
  }
  wrap.querySelector('.cfg-tab[data-tab="backup"]').addEventListener("click", () => carregarCopias(wrap));
  wrap.querySelector("#cfg-copias-agora").addEventListener("click", async () => {
    if (estado.busy) return;
    estado.busy = true;
    try {
      await desenharDepois(wrap, copiarAgora());
      status(wrap, "#cfg-copias-status", `${icon("check", { size: 12 })} ${t("copias.feita")}`);
    } catch (err) {
      status(wrap, "#cfg-copias-status", escapeHtml(err.message), true);
    } finally {
      estado.busy = false;
    }
  });
  wrap.querySelector("#cfg-copias-pasta-salvar").addEventListener("click", () => {
    const pasta = wrap.querySelector("#cfg-copias-pasta").value.trim();
    if (!pasta) return status(wrap, "#cfg-copias-pasta-status", t("copias.escreva_o_caminho_da_pasta"), true);
    salvarPasta(wrap, pasta);
  });
  wrap.querySelector("#cfg-copias-pasta-tirar").addEventListener("click", () => salvarPasta(wrap, null));
  wrap.querySelector("#cfg-copias-lista").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-restaurar]");
    if (btn) restaurar(wrap, btn.dataset.restaurar, btn.dataset.quando);
  });
}
