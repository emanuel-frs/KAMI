// js/widgets/habitos-hoje.js — ORG-04
import { listHabitos } from "../api/habitos.js";
import { escapeHtml } from "../components/format.js";
import { navigateTo } from "../components/navigate.js";
import { listenWhileConnected } from "../components/window-listener.js";
import { alternarHoje, itemHojeHtml } from "../components/habito-linha.js";
import { showErrorModal } from "../modals/err-modal.js";

/**
 * Hábitos de hoje: os hábitos ativos que valem hoje, marcáveis daqui
 * mesmo (mesma linha da tela de hábitos — components/habito-linha.js). Os de dias
 * fixos fora do dia não aparecem: o widget é "o que falta hoje".
 * Recarrega com kami:habitos-mudaram (tela ou outro widget marcou).
 */
export async function render(el) {
  el.innerHTML = `
    <div class="hb-hoje hb-widget"><div class="empty-state">carregando hábitos…</div></div>
    <a href="#" class="nr-todas" data-hb-todos>ver hábitos →</a>`;
  const lista = el.querySelector(".hb-hoje");
  let habitos = [];

  async function load() {
    try {
      habitos = (await listHabitos()).filter((h) => h.status === "ativo" && h.vale_hoje);
    } catch (err) {
      lista.innerHTML = `<div class="empty-state">erro ao carregar hábitos: ${escapeHtml(err.message)}</div>`;
      return;
    }
    lista.innerHTML = habitos.length
      ? habitos.map(itemHojeHtml).join("")
      : '<div class="empty-state">nenhum hábito pra hoje — crie um na tela hábitos (alt+9).</div>';
  }

  el.addEventListener("click", async (e) => {
    if (e.target.closest("[data-hb-todos]")) {
      e.preventDefault();
      navigateTo("habitos");
      return;
    }
    const botao = e.target.closest("[data-marcar]");
    const h = botao && habitos.find((x) => x.id === botao.dataset.habitoId);
    if (!h) return;
    try {
      const novo = await alternarHoje(h);
      habitos = habitos.map((x) => (x.id === novo.id ? novo : x));
      lista.innerHTML = habitos.map(itemHojeHtml).join("");
      lista.querySelector(`[data-habito-id="${novo.id}"]`)?.focus();
      window.dispatchEvent(new CustomEvent("kami:habitos-mudaram", { detail: { origem: "widget" } }));
    } catch (err) {
      showErrorModal(err.message, "hábitos");
    }
  });

  await load();
  listenWhileConnected(el, "kami:habitos-mudaram", (e) => {
    if (e.detail?.origem !== "widget") load();
  });
}
