// js/widgets/notas-rapidas.js — ORG-01 (P-34)
import { listNotas, createNota } from "../api/notas.js";
import { escapeHtml } from "../components/format.js";
import { navigateTo } from "../components/navigate.js";
import { listenWhileConnected } from "../components/window-listener.js";
import { corDaNota } from "../components/nota-cores.js";

const MAX_ITENS = 6;

/**
 * Notas rápidas: as fixadas (ou, sem nenhuma fixada, as últimas editadas)
 * + um campo pra anotar sem sair da tela. O texto digitado vira o título
 * da nota (e o texto, se passar de uma linha curta); clicar abre a nota
 * na Organização. Nota trancada aparece só com o título (o texto nunca
 * sai do backend sem o PIN).
 */
export async function render(el) {
  el.innerHTML = `
    <form class="nr-form">
      <input type="text" class="nr-input" maxlength="200" placeholder="anotar algo… (Enter)" aria-label="nova nota rápida">
    </form>
    <div class="nr-lista"><div class="empty-state">carregando notas…</div></div>
    <a href="#" class="nr-todas">ver todas as notas →</a>`;
  const lista = el.querySelector(".nr-lista");

  async function load() {
    let notas;
    try {
      notas = await listNotas({ fixadas: true });
      if (!notas.length) notas = (await listNotas()).slice(0, MAX_ITENS);
    } catch (err) {
      lista.innerHTML = `<div class="empty-state">erro ao carregar notas: ${escapeHtml(err.message)}</div>`;
      return;
    }
    if (!notas.length) {
      lista.innerHTML = '<div class="empty-state">nenhuma nota ainda — anote algo acima.</div>';
      return;
    }
    lista.innerHTML = notas
      .slice(0, MAX_ITENS)
      .map((n) => {
        const cor = corDaNota(n.cor);
        return `
        <div class="nr-item" data-nr-abrir="${n.id}"${cor ? ` style="--nota-cor:${cor}"` : ""}>
          <span class="nr-titulo">${escapeHtml(n.titulo || "(sem título)")}</span>
          <span class="nr-previa">${n.trancada ? "conteúdo trancado" : escapeHtml(n.previa || "")}</span>
        </div>`;
      })
      .join("");
  }

  el.querySelector(".nr-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = el.querySelector(".nr-input");
    const texto = input.value.trim();
    if (!texto) return;
    input.disabled = true;
    try {
      // linha curta = só título; mais que isso, o título é o começo
      const titulo = texto.length <= 80 ? texto : texto.slice(0, 77).replace(/\s+\S*$/, "") + "…";
      await createNota({ titulo, conteudo: texto.length <= 80 ? "" : texto, fixada: true });
      input.value = "";
      await load();
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
  el.addEventListener("click", (e) => {
    const item = e.target.closest("[data-nr-abrir]");
    if (item) navigateTo("organizacao", { tab: "notas", notaId: item.dataset.nrAbrir });
    if (e.target.closest(".nr-todas")) {
      e.preventDefault();
      navigateTo("organizacao", { tab: "notas" });
    }
  });

  await load();
  listenWhileConnected(el, "kami:notas-mudaram", load);
}
