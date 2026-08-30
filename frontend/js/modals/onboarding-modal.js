import { updateOnboarding } from "../api/perfil.js";
import { escapeHtml } from "../components/format.js";
import { icon } from "../components/icons.js";
import { accentLabel } from "../components/accent-colors.js";
import { store } from "../state/store.js";

/**
 * Modal de onboarding (item 15.6, decisão 25 — REVISADA; texto
 * reescrito por completo na etapa 4 do plano-onboarding-kami.md).
 *
 * Formato: tour multi-step (vários modais em sequência, um passo por
 * módulo/conceito). Cada passo tem uma mini-ilustração estática (HTML/CSS
 * com dados fake, reaproveitando classes reais de widget) em vez de só
 * texto corrido, pra ficar mais próximo de um onboarding de jogo.
 *
 * Reescrita da etapa 4 (não foi só ajuste de texto):
 * - Título/descrição de cada passo agora são funções de `ctx` (nome e
 *   cor reais, lidos de store.get("profile") a cada abertura/render —
 *   assim o tour reflete o que a etapa 2/3 acabou de coletar, e também
 *   fica correto se reaberto depois de o usuário trocar nome/cor no
 *   perfil).
 * - Fio narrativo: o mesmo marco de exemplo ("fundamentos de python")
 *   aparece em quatro telas (núcleo → aprendizado → metas → calendário),
 *   mostrando como um módulo alimenta o outro, em vez de blocos
 *   desconectados.
 * - Último passo (calendário) deixa claro que isso é só uma prévia, e
 *   que cada tela vai ter dicas mais detalhadas na hora de usar de
 *   verdade (etapa 5, screen-tips-registry.js — calendário ainda não
 *   tem dicas próprias registradas, só as outras 6 telas do v1).
 *
 * Comportamento (mantido):
 * - Abre automaticamente no primeiro boot, encadeado depois da etapa 2/3
 *   (app.js → openKamiIntro(() => openOnboardingModal())).
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

/** Lê nome/cor atuais do perfil pra personalizar os textos do tour. */
function buildCtx() {
  const profile = store.get("profile") ?? {};
  return {
    name: profile.display_name && profile.display_name !== "usuário" ? profile.display_name : "você",
    colorLabel: accentLabel(profile.accent_color ?? "#8fbf8f"),
  };
}

// ─── Passos do tour ──────────────────────────────────────────────────────────
// Cada passo: { title(ctx), desc(ctx), illustration(ctx) -> HTMLstring }
const STEPS = [
  {
    title: (ctx) => `bora, ${ctx.name}`,
    desc: () =>
      "essa é uma prévia rápida — oito telas, meio minuto cada. o fio condutor do kami: toda ação que você registra em qualquer módulo credita xp num atributo, sobe de nível e pode desbloquear conquistas. vou usar o mesmo exemplo em mais de uma tela pra você ver como um módulo alimenta o outro.",
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
    title: () => "perfil",
    desc: (ctx) =>
      `esse é você: nome, ${ctx.colorLabel} como cor de destaque — dá pra trocar quando quiser, inclusive agora se mudar de ideia — e o avatar em ascii, gerado 100% local a partir de uma foto que nunca é salva. perfil e núcleo aceitam os mesmos widgets configuráveis: arraste, redimensione, adicione, remova.`,
    illustration: (ctx) => `
      <div class="ob-illus ob-illus--perfil">
        <div class="ob-profile-card">
          <pre class="ob-avatar">░░▒▒░░
░▒████▒░
░▒████▒░
░░▒▒░░</pre>
          <div class="ob-profile-info">
            <span class="ob-profile-name">${escapeHtml(ctx.name)}</span>
            <span class="ob-profile-sub">cor de destaque <span class="ob-accent-dot"></span></span>
          </div>
        </div>
      </div>`,
  },
  {
    title: () => "núcleo",
    desc: () =>
      "o coração da gamificação: 5 atributos que sobem de nível conforme você registra ações, o log cronológico de tudo que foi feito, conquistas por regra fixa e o painel de prioridades. repara na última linha do log ali embaixo — aquele marco de aprendizado vai reaparecer daqui a duas telas.",
    illustration: () => `
      <div class="ob-illus ob-illus--nucleo">
        <div class="ob-nucleo-attrs">
          ${["carreira", "finanças", "aprendizado", "organização", "metas"]
            .map((a, i) => {
              const pct = [38, 72, 55, 20, 84][i];
              return `<div class="ob-attr-line">
              <span class="ob-attr-name">${a}</span>
              <span class="ob-mini-bar"><span class="ob-mini-fill" style="width:${pct}%"></span></span>
              <span class="ob-lv">lv${[2, 5, 3, 1, 7][i]}</span>
            </div>`;
            })
            .join("")}
          <div class="ob-attr-row" style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border-soft);">
            <span class="ob-attr">${icon("check", { size: 9 })} concluiu "fundamentos de python"</span>
            <span class="ob-attr-xp">+50 xp</span>
          </div>
        </div>
      </div>`,
  },
  {
    title: () => "finanças",
    desc: () =>
      "renda recorrente com cadastro próprio (várias fontes, dia fixo/dia útil/intervalo de dias/depende de outra fonte, ou avulsa) e cálculo de dia útil real, cartões, contas fixas, dívidas, compras parceladas, assinaturas e gastos avulsos — visão mensal de entradas vs. saídas, comparando com o mês anterior, mais gráficos de fluxo, categorias, evolução e limites de cartão. cada lançamento daqui também vira uma linha no log do núcleo, com xp igual a qualquer outro módulo.",
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
    title: () => "aprendizado",
    desc: () =>
      'trilhas de estudo com marcos, progresso calculado automaticamente, roadmap visual com drag-and-drop pra reordenar e um heatmap estilo GitHub. esse marco "fundamentos de python" concluído aqui foi exatamente o que gerou aquele +50 xp que você viu no log do núcleo, duas telas atrás.',
    illustration: () => `
      <div class="ob-illus ob-illus--aprendizado">
        <div class="ob-track-header">
          <span class="ob-track-name">programação</span>
          <span class="ob-track-pct">67%</span>
        </div>
        <div class="ob-track-bar"><span class="ob-track-fill" style="width:67%"></span></div>
        <div class="ob-milestones">
          <div class="ob-milestone ob-ms-done">${icon("check", { size: 9 })} fundamentos de python</div>
          <div class="ob-milestone ob-ms-done">${icon("check", { size: 9 })} fastapi — rotas e modelos</div>
          <div class="ob-milestone">  sqlite sem ORM</div>
          <div class="ob-milestone ob-ms-faint">  testes com pytest</div>
        </div>
      </div>`,
  },
  {
    title: () => "organização",
    desc: () =>
      "hub de acesso rápido: links categorizados com favicon, status dos seus repositórios do GitHub, e-mail via IMAP de verdade — assunto, remetente e trecho do corpo em texto puro, sem HTML de terceiros e sem IA lendo nada por enquanto — e uma busca na web com resumo inline (chave pessoal opcional; sem ela, cai pro DuckDuckGo direto).",
    illustration: () => `
      <div class="ob-illus ob-illus--org">
        <div class="ob-org-row">
          <span class="ob-org-icon">${icon("link", { size: 11 })}</span>
          <span class="ob-org-label">github.com/usuario/kami</span>
        </div>
        <div class="ob-org-row">
          <span class="ob-org-icon">${icon("mail", { size: 11 })}</span>
          <span class="ob-org-label">3 mensagens não lidas</span>
        </div>
        <div class="ob-email-preview">
          <span class="ob-email-from">dev@lista.org</span>
          <span class="ob-email-subj">release v0.9 disponível</span>
        </div>
      </div>`,
  },
  {
    title: () => "metas pessoais",
    desc: () =>
      'metas financeiras (tipo aquela viagem ali embaixo) ou livres, cada uma com prazo e histórico de contribuições. repara na segunda: metas do tipo aprendizado ficam vinculadas a uma trilha — a mesma de programação que você viu — e avançam sozinhas conforme os marcos são concluídos, sem precisar atualizar nada na mão. isso fecha o fio: um marco concluído em aprendizado virou xp no núcleo e progresso aqui, tudo pela mesma ação.',
    illustration: () => `
      <div class="ob-illus ob-illus--metas">
        <div class="ob-meta-card">
          <span class="ob-meta-title">viagem para o japão</span>
          <div class="ob-meta-bar"><span class="ob-meta-fill" style="width:43%"></span></div>
          <span class="ob-meta-sub">R$ 4.300 / R$ 10.000 · vence em dez</span>
        </div>
        <div class="ob-meta-card">
          <span class="ob-meta-title">dominar python</span>
          <div class="ob-meta-bar"><span class="ob-meta-fill" style="width:67%"></span></div>
          <span class="ob-meta-sub">trilha: programação · avança sozinha</span>
        </div>
      </div>`,
  },
  {
    title: (ctx) => `calendário — é só uma prévia, ${ctx.name}`,
    desc: () =>
      'todo compromisso financeiro (contas fixas, dívidas, parcelas, assinaturas), meta com prazo e marco concluído cai automaticamente aqui, cada tipo com sua cor — sem precisar cadastrar nada duas vezes. dá pra criar eventos manuais também, arrastar pra outro dia, filtrar por tipo dentro de um dia específico e ver alertas do que está vencendo em breve. essa foi só a casca — quando você entrar em cada tela de verdade, mostro dicas específicas de cada botão e widget, direto ali.',
    illustration: () => `
      <div class="ob-illus ob-illus--calendario">
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${icon("receipt", { size: 9 })} conta de luz</span>
          <span class="ob-attr-xp">venceu ontem</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${icon("target", { size: 9 })} viagem para o japão</span>
          <span class="ob-attr-xp">vence em dez</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${icon("star", { size: 9 })} concluiu "fundamentos de python"</span>
          <span class="ob-attr-xp">há 2 dias</span>
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
        <span class="close" data-action="close" aria-label="fechar">${icon("x")}</span>
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
  const ctx = buildCtx();

  modalEl.querySelector("#ob-step-label").textContent = `${step + 1} / ${total}`;
  modalEl.querySelector("#ob-title").textContent = s.title(ctx);
  modalEl.querySelector("#ob-desc").textContent = s.desc(ctx);
  modalEl.querySelector("#ob-illus-wrap").innerHTML = s.illustration(ctx);

  // dots
  const dotsEl = modalEl.querySelector("#ob-dots");
  dotsEl.innerHTML = STEPS.map((_, i) => `<span class="ob-dot${i === step ? " ob-dot--on" : ""}"></span>`).join("");

  // botão anterior
  const prevBtn = modalEl.querySelector("#ob-btn-prev");
  prevBtn.style.display = step === 0 ? "none" : "";

  // botão próximo / finalizar
  const nextBtn = modalEl.querySelector("#ob-btn-next");
  const isLast = step === total - 1;
  nextBtn.innerHTML = isLast ? `${icon("check", { size: 13 })} começar a usar` : `próximo ${icon("arrow-right", { size: 13 })}`;
  nextBtn.dataset.last = isLast ? "1" : "";
}

function wireModal(wrap) {
  wrap.querySelector('[data-action="close"]').addEventListener("click", () => closeOnboardingModal());
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
    // atualiza o store local também — não só o backend — pra quem estiver
    // inscrito em store.subscribe("profile") (ex: nucleo-tips.js, etapa 5)
    // reagir na hora, já que o Núcleo normalmente já montou por baixo
    // desse modal antes dele existir (ver boot() em app.js)
    const profile = store.get("profile");
    if (profile) store.set("profile", { ...profile, onboarding_completed: true });
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