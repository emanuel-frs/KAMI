import { updateOnboarding } from "../api/perfil.js";
import { escapeHtml } from "../components/format.js";
import { icon } from "../components/icons.js";

/**
 * Modal de onboarding (item 15.6, decisão 25 — REVISADA).
 *
 * Formato: tour multi-step (vários modais em sequência, um passo por
 * módulo/conceito). Cada passo tem uma mini-ilustração estática (HTML/CSS
 * com dados fake, reaproveitando classes reais de widget) em vez de só
 * texto corrido, pra ficar mais próximo de um onboarding de jogo.
 *
 * Comportamento:
 * - Abre automaticamente no primeiro boot (app.js, quando
 *   profile.onboarding_completed === false).
 * - Reabrível depois via widget de perfil ("ver tutorial novamente") —
 *   reabrir manualmente sempre começa do passo 0 sem alterar a flag.
 * - Fechar ao chegar no último passo (ou via X) marca
 *   onboarding_completed = true no backend (idempotente).
 * - Fechar antes do último passo (via X) também marca como visto, pra
 *   não incomodar quem simplesmente não quer o tour.
 */

let modalEl = null;
let currentStep = 0;
let marking = false;

// ─── Passos do tour ──────────────────────────────────────────────────────────
// Cada passo: { title, desc, illustration() -> HTMLstring }
const STEPS = [
  {
    title: "bem-vindo(a) ao kami",
    desc:
      "o kami transforma organização de vida em um jogo: toda ação que você " +
      "registra credita XP no atributo correspondente, sobe seu nível e pode " +
      "desbloquear conquistas. este tour mostra os módulos desta versão — " +
      "cada tela em 30 segundos.",
    illustration: () => `
      <div class="ob-illus ob-illus--intro">
        <div class="ob-illus-row">
          <span class="ob-xp-bar"><span class="ob-xp-fill" style="width:62%"></span></span>
          <span class="ob-level">lv 4</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">aprendizado</span>
          <span class="ob-attr-xp">+50 xp</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">finanças</span>
          <span class="ob-attr-xp">+20 xp</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">metas</span>
          <span class="ob-attr-xp">+30 xp</span>
        </div>
      </div>`,
  },
  {
    title: "perfil",
    desc:
      "configure seu nome de exibição, a cor de destaque do app e seu avatar " +
      "pessoal em ASCII — gerado 100% local a partir de uma foto (a foto " +
      "original nunca é salva). as telas de perfil e núcleo aceitam widgets " +
      "do catálogo padrão: adicione, remova e redimensione livremente.",
    illustration: () => `
      <div class="ob-illus ob-illus--perfil">
        <div class="ob-profile-card">
          <pre class="ob-avatar">░░▒▒░░
░▒████▒░
░▒████▒░
░░▒▒░░</pre>
          <div class="ob-profile-info">
            <span class="ob-profile-name">usuário</span>
            <span class="ob-profile-sub">cor de destaque <span class="ob-accent-dot"></span></span>
          </div>
        </div>
      </div>`,
  },
  {
    title: "núcleo",
    desc:
      "o coração da gamificação: 5 atributos (carreira, finanças, aprendizado, " +
      "organização, metas pessoais) que ganham XP ao registrar ações. " +
      "aqui ficam também o log cronológico de tudo que foi feito, conquistas " +
      "por regra fixa e o painel de prioridades.",
    illustration: () => `
      <div class="ob-illus ob-illus--nucleo">
        <div class="ob-nucleo-attrs">
          ${["carreira","finanças","aprendizado","organização","metas"].map((a, i) => {
            const pct = [38, 72, 55, 20, 84][i];
            return `<div class="ob-attr-line">
              <span class="ob-attr-name">${a}</span>
              <span class="ob-mini-bar"><span class="ob-mini-fill" style="width:${pct}%"></span></span>
              <span class="ob-lv">lv${[2,5,3,1,7][i]}</span>
            </div>`;
          }).join("")}
        </div>
      </div>`,
  },
  {
    title: "finanças",
    desc:
      "controle completo de renda (com cálculo de dia útil real), cartões e " +
      "contas bancárias, contas fixas, dívidas, compras parceladas, " +
      "assinaturas e gastos avulsos. visão mensal de entradas vs saídas e " +
      "comparação com o mês anterior.",
    illustration: () => `
      <div class="ob-illus ob-illus--financas">
        <div class="ob-fin-row">
          <span class="ob-fin-label">entradas</span>
          <span class="ob-fin-val ob-fin-pos">+ R$ 3.100</span>
        </div>
        <div class="ob-fin-row">
          <span class="ob-fin-label">saídas</span>
          <span class="ob-fin-val ob-fin-neg">− R$ 1.840</span>
        </div>
        <div class="ob-fin-divider"></div>
        <div class="ob-fin-row">
          <span class="ob-fin-label">saldo</span>
          <span class="ob-fin-val ob-fin-pos">R$ 1.260</span>
        </div>
        <div class="ob-fin-next">próx. salário: <span class="ob-fin-date">05 ago</span></div>
      </div>`,
  },
  {
    title: "aprendizado",
    desc:
      "trilhas de estudo (programação, inglês, francês…) com lista de marcos, " +
      "progresso calculado automaticamente e um roadmap visual com drag-and-drop " +
      "para reordenar. um heatmap estilo GitHub mostra sua atividade ao longo " +
      "do tempo.",
    illustration: () => `
      <div class="ob-illus ob-illus--aprendizado">
        <div class="ob-track-header">
          <span class="ob-track-name">programação</span>
          <span class="ob-track-pct">67%</span>
        </div>
        <div class="ob-track-bar"><span class="ob-track-fill" style="width:67%"></span></div>
        <div class="ob-milestones">
          <div class="ob-milestone ob-ms-done">✓ fundamentos de python</div>
          <div class="ob-milestone ob-ms-done">✓ fastapi — rotas e modelos</div>
          <div class="ob-milestone">  sqlite sem ORM</div>
          <div class="ob-milestone ob-ms-faint">  testes com pytest</div>
        </div>
      </div>`,
  },
  {
    title: "organização",
    desc:
      "hub de acesso rápido: links categorizados com favicon, status dos seus " +
      "repositórios do GitHub e leitura de e-mail via IMAP (assunto, remetente " +
      "e trecho do corpo em texto puro — sem IA no v1, sem rastreadores).",
    illustration: () => `
      <div class="ob-illus ob-illus--org">
        <div class="ob-org-row">
          <span class="ob-org-icon">🔗</span>
          <span class="ob-org-label">github.com/usuario/kami</span>
        </div>
        <div class="ob-org-row">
          <span class="ob-org-icon">✉</span>
          <span class="ob-org-label">3 mensagens não lidas</span>
        </div>
        <div class="ob-email-preview">
          <span class="ob-email-from">dev@lista.org</span>
          <span class="ob-email-subj">release v0.9 disponível</span>
        </div>
      </div>`,
  },
  {
    title: "metas pessoais",
    desc:
      "metas financeiras (ex: juntar pra uma viagem) ou livres (ex: academia " +
      "3x/semana) com prazo e histórico de contribuições. cada meta concluída " +
      "dá XP bônus no núcleo — funciona como uma quest.",
    illustration: () => `
      <div class="ob-illus ob-illus--metas">
        <div class="ob-meta-card">
          <span class="ob-meta-title">viagem para o japão</span>
          <div class="ob-meta-bar"><span class="ob-meta-fill" style="width:43%"></span></div>
          <span class="ob-meta-sub">R$ 4.300 / R$ 10.000 · vence em dez</span>
        </div>
        <div class="ob-meta-card ob-meta-card--done">
          <span class="ob-meta-title">✓ academia 3x/semana</span>
          <span class="ob-meta-sub">concluída · +30 xp</span>
        </div>
      </div>`,
  },
];

// ─── Construção do DOM ────────────────────────────────────────────────────────

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "onboarding-modal";
  wrap.innerHTML = `
    <div class="modal ob-modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="ob-step-label" id="ob-step-label"></span>
        <span class="close" data-action="close" aria-label="fechar">×</span>
      </div>
      <div class="modal-body ob-body">
        <div class="ob-illus-wrap" id="ob-illus-wrap"></div>
        <div class="ob-text">
          <h2 class="ob-title" id="ob-title"></h2>
          <p class="ob-desc" id="ob-desc"></p>
        </div>
      </div>
      <div class="ob-footer">
        <button type="button" class="btn ob-btn-prev" id="ob-btn-prev" style="display:none">
          ${icon("arrow-left", { size: 13 })} anterior
        </button>
        <div class="ob-dots" id="ob-dots"></div>
        <button type="button" class="btn primary ob-btn-next" id="ob-btn-next">
          próximo ${icon("arrow-right", { size: 13 })}
        </button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function renderStep(step) {
  const s = STEPS[step];
  const total = STEPS.length;

  modalEl.querySelector("#ob-step-label").textContent =
    `${step + 1} / ${total}`;
  modalEl.querySelector("#ob-title").textContent = s.title;
  modalEl.querySelector("#ob-desc").textContent = s.desc;
  modalEl.querySelector("#ob-illus-wrap").innerHTML = s.illustration();

  // dots
  const dotsEl = modalEl.querySelector("#ob-dots");
  dotsEl.innerHTML = STEPS.map((_, i) =>
    `<span class="ob-dot${i === step ? " ob-dot--on" : ""}"></span>`
  ).join("");

  // botão anterior
  const prevBtn = modalEl.querySelector("#ob-btn-prev");
  prevBtn.style.display = step === 0 ? "none" : "";

  // botão próximo / finalizar
  const nextBtn = modalEl.querySelector("#ob-btn-next");
  const isLast = step === total - 1;
  nextBtn.innerHTML = isLast
    ? `${icon("check", { size: 13 })} começar a usar`
    : `próximo ${icon("arrow-right", { size: 13 })}`;
  nextBtn.dataset.last = isLast ? "1" : "";
}

function wireModal(wrap) {
  wrap.querySelector('[data-action="close"]').addEventListener("click", () =>
    closeOnboardingModal()
  );
  // backdrop click
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeOnboardingModal();
  });
  wrap.querySelector("#ob-btn-prev").addEventListener("click", () => {
    if (currentStep > 0) {
      currentStep--;
      renderStep(currentStep);
    }
  });
  wrap.querySelector("#ob-btn-next").addEventListener("click", () => {
    if (currentStep < STEPS.length - 1) {
      currentStep++;
      renderStep(currentStep);
    } else {
      closeOnboardingModal();
    }
  });
}

// ─── API pública ──────────────────────────────────────────────────────────────

async function markSeen() {
  if (marking) return;
  marking = true;
  try {
    await updateOnboarding(true);
  } catch (err) {
    // não bloqueia o fechamento — pior caso: o tutorial reaparece no próximo boot
    console.error("erro ao marcar onboarding como visto:", err);
  } finally {
    marking = false;
  }
}

/**
 * Abre o modal de onboarding.
 * Sempre começa do passo 0 (tanto no boot automático quanto no reabrir manual).
 */
export function openOnboardingModal() {
  modalEl = modalEl || buildModal();
  currentStep = 0;
  renderStep(0);
  modalEl.classList.add("open");
}

/**
 * Fecha o modal e marca onboarding_completed = true no backend
 * (idempotente — seguro chamar mesmo se já estava true).
 */
export function closeOnboardingModal() {
  if (!modalEl) return;
  modalEl.classList.remove("open");
  markSeen();
}
