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

const ACOES = {
  importar: "antes de importar",
  "apagar-tudo": "antes de apagar tudo",
  "redefinir-chave": "antes de redefinir a chave",
  atualizar: "antes de atualizar o app",
  restaurar: "antes de restaurar",
};

export function copiasSectionHtml() {
  return `
      <div class="settings-section" id="cfg-copias">
        <h4>cópias automáticas</h4>
        <p class="settings-desc">o kami guarda sozinho uma cópia do banco por semana (as 4 últimas) e uma antes de importar, apagar tudo, redefinir a chave, restaurar ou atualizar o app. restaurar volta tudo pra como estava naquela hora — e o estado de agora fica guardado antes.</p>
        <p class="settings-note">as cópias ficam no mesmo disco do kami: protegem de erro e de banco estragado, <strong>não</strong> de perder o disco. pra isso, use a pasta extra abaixo ou exporte um backup.</p>
        <ul class="cfg-copias-lista" id="cfg-copias-lista"><li class="settings-desc">carregando…</li></ul>
        <div class="form-actions">
          <button class="btn sm" id="cfg-copias-agora">fazer uma cópia agora</button>
        </div>
        <p class="settings-status" id="cfg-copias-status"></p>
        <div class="field">
          <label for="cfg-copias-pasta">pasta extra (opcional) — pendrive, HD externo ou pasta sincronizada (Drive, Dropbox...)</label>
          <input type="text" id="cfg-copias-pasta" placeholder="ex.: /media/pendrive/kami ou D:\\kami" autocomplete="off" spellcheck="false" maxlength="1000">
        </div>
        <p class="settings-note">a cópia semanal também vai pra lá (o kami só grava e apaga os próprios arquivos kami-semanal-*.db). as senhas salvas vão cifradas com a chave <strong>deste</strong> computador: noutra máquina o resto abre, elas não — pra levar tudo, exporte com senha.</p>
        <div class="form-actions">
          <button class="btn sm" id="cfg-copias-pasta-escolher" hidden>escolher pasta…</button>
          <button class="btn sm" id="cfg-copias-pasta-salvar">usar esta pasta</button>
          <button class="btn sm" id="cfg-copias-pasta-tirar" hidden>parar de copiar pra lá</button>
        </div>
        <p class="settings-status" id="cfg-copias-pasta-status"></p>
      </div>`;
}

function tamanho(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function descricao(c) {
  if (c.tipo === "semanal") return "semanal";
  if (c.tipo === "atualizacao") return `antes da versão ${escapeHtml(c.acao || "nova")}`;
  return escapeHtml(ACOES[c.acao] || `antes de ${c.acao}`);
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
            <button type="button" class="btn sm" data-restaurar="${escapeHtml(c.nome)}" data-quando="${escapeHtml(fmtDataHora(c.quando))}">restaurar</button>
          </li>`
        )
        .join("")
    : '<li class="settings-desc">nenhuma cópia ainda — a primeira sai ao abrir o kami.</li>';

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
      `<span class="cfg-seg-warn">[!]</span> a pasta não está disponível agora (pendrive ou disco desconectado?)${dados.extra_ok_em ? ` — última cópia lá: ${escapeHtml(fmtDataHora(dados.extra_ok_em))}` : ""}. o kami tenta de novo sozinho.`,
      dados.extra_atrasada
    );
  } else {
    status(wrap, "#cfg-copias-pasta-status", `${icon("check", { size: 12 })} última cópia lá: ${escapeHtml(fmtDataHora(dados.extra_ok_em))}`);
  }
}

export async function carregarCopias(wrap) {
  try {
    render(wrap, await getBackups());
  } catch (err) {
    wrap.querySelector("#cfg-copias-lista").innerHTML = `<li class="settings-desc">não deu pra listar as cópias: ${escapeHtml(err.message)}</li>`;
  }
}

async function salvarPasta(wrap, pasta) {
  if (estado.busy) return;
  estado.busy = true;
  try {
    render(wrap, await definirPastaExtra(pasta));
    if (pasta) status(wrap, "#cfg-copias-pasta-status", `${icon("check", { size: 12 })} pasta salva — a cópia mais recente já foi pra lá`);
  } catch (err) {
    status(wrap, "#cfg-copias-pasta-status", escapeHtml(err.message), true);
  } finally {
    estado.busy = false;
  }
}

async function restaurar(wrap, nome, quando) {
  if (estado.busy) return;
  const sim = await showConfirmModal(
    `volta TODOS os dados do kami pra cópia de ${quando}. o que você fez depois disso sai — mas o estado de agora fica guardado como uma cópia "antes de restaurar", então dá pra voltar atrás.`,
    { title: "restaurar cópia", confirmText: "sim, restaurar", danger: true }
  );
  if (!sim) return;
  estado.busy = true;
  try {
    await restaurarCopia(nome);
    window.location.reload();
  } catch (err) {
    estado.busy = false;
    showErrorModal(err.message, "não deu pra restaurar a cópia");
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
      options: { directory: true, multiple: false, title: "pasta extra das cópias do kami" },
    });
    if (!pasta) return; // cancelou
    wrap.querySelector("#cfg-copias-pasta").value = pasta;
    salvarPasta(wrap, pasta);
  } catch (err) {
    status(wrap, "#cfg-copias-pasta-status", `não deu pra abrir o seletor: ${escapeHtml(String(err))} — escreva o caminho no campo`, true);
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
      render(wrap, await copiarAgora());
      status(wrap, "#cfg-copias-status", `${icon("check", { size: 12 })} cópia feita`);
    } catch (err) {
      status(wrap, "#cfg-copias-status", escapeHtml(err.message), true);
    } finally {
      estado.busy = false;
    }
  });
  wrap.querySelector("#cfg-copias-pasta-salvar").addEventListener("click", () => {
    const pasta = wrap.querySelector("#cfg-copias-pasta").value.trim();
    if (!pasta) return status(wrap, "#cfg-copias-pasta-status", "escreva o caminho da pasta", true);
    salvarPasta(wrap, pasta);
  });
  wrap.querySelector("#cfg-copias-pasta-tirar").addEventListener("click", () => salvarPasta(wrap, null));
  wrap.querySelector("#cfg-copias-lista").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-restaurar]");
    if (btn) restaurar(wrap, btn.dataset.restaurar, btn.dataset.quando);
  });
}
