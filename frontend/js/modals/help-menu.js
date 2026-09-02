import { icon } from "../components/icons.js";
import { openOnboardingModal } from "./onboarding-modal.js";
import { getScreenTipsReplay } from "../components/screen-tips-registry.js";

/**
 * Botão de ajuda (etapa 6, seção 7) — ícone de
 * interrogação ao lado do botão de configurações, sempre visível. Ao
 * tocar, mostra duas opções:
 *
 *   1. "rever tour geral" — sempre disponível, reabre o tour de 8 telas
 *      (onboarding-modal.js) do início, sem mexer em onboarding_completed
 *      (mesmo comportamento que "ver tutorial novamente" no widget de
 *      perfil, só que acessível de qualquer tela).
 *   2. "rever dicas desta tela" — disponível nas telas que registram
 *      dicas contextuais via screen-tips-registry.js (etapa 5); hoje
 *      as 7 telas do v1 (perfil, núcleo, finanças, aprendizado,
 *      organização, metas, calendário) já têm. Fica desabilitada em vez de
 *      escondida como defesa pra qualquer tela futura que ainda não
 *      tenha registrado sua sequência de dicas, não porque falte
 *      cobertura hoje.
 *
 * Vive fora do container de qualquer página (sidebar é global), então
 * não consulta o grid da página diretamente — pergunta pro
 * screen-tips-registry.js o que a página montada no momento registrou.
 */
let pop = null;
let onDocClick = null;

function buildPop() {
  const el = document.createElement("div");
  el.className = "help-menu-pop";
  el.id = "help-menu-pop";
  el.innerHTML = `
    <button type="button" class="help-menu-item" data-action="tour">
      ${icon("undo", { size: 12 })} rever tour geral
    </button>
    <button type="button" class="help-menu-item" data-action="screen-tips">
      ${icon("circle-help", { size: 12 })} rever dicas desta tela
    </button>
  `;
  el.querySelector('[data-action="tour"]').addEventListener("click", () => {
    closePop();
    openOnboardingModal();
  });
  el.querySelector('[data-action="screen-tips"]').addEventListener("click", () => {
    const replay = getScreenTipsReplay();
    if (!replay) return; // botão já fica disabled nesse caso, mas confere de novo por segurança
    closePop();
    replay();
  });
  return el;
}

function syncScreenTipsAvailability() {
  const btn = pop?.querySelector('[data-action="screen-tips"]');
  if (!btn) return;
  const available = Boolean(getScreenTipsReplay());
  btn.disabled = !available;
  btn.title = available ? "" : "esta tela ainda não tem dicas contextuais";
}

function openPop() {
  syncScreenTipsAvailability();
  pop.classList.add("open");
}

function closePop() {
  pop?.classList.remove("open");
}

export function wireHelpButton() {
  const btn = document.getElementById("btn-open-help");
  const wrap = document.getElementById("btn-open-help")?.parentElement;
  if (!btn || !wrap) return;

  btn.innerHTML = icon("circle-help", { size: 14 });

  pop = buildPop();
  wrap.appendChild(pop);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !pop.classList.contains("open");
    if (opening) openPop();
    else closePop();
  });

  onDocClick = (e) => {
    if (!e.target.closest(".sidebar-footer-actions")) closePop();
  };
  document.addEventListener("click", onDocClick);
}
