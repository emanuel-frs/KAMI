import { updateOnboarding } from "../api/perfil.js";
import { escapeHtml, fmtDataCurta } from "../components/format.js";
import { icon } from "../components/icons.js";
import { accentLabel } from "../components/accent-colors.js";
import { nomeAtributo } from "../components/textos-sistema.js";
import { store } from "../state/store.js";
import { noIdiomaAtual, t } from "../i18n.js";

/**
 * Modal de onboarding (item 15.6, decisão 25 — REVISADA; texto
 * reescrito por completo na etapa 4 do onboarding).
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
 *   verdade (etapa 5, screen-tips-registry.js — calendário já tem
 *   dicas próprias registradas, junto com as outras 6 telas do v1).
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
 *
 * Acessibilidade (item 5 das pendências — "modal de onboarding" não
 * revisado): modal-accessibility.js decora automaticamente qualquer
 * `.modal-backdrop` (role/aria-modal/focus trap/devolução de foco), mas
 * só herda aria-labelledby sozinho se achar um título dentro de
 * `.modal-head` — aqui o `.modal-head` só tem o contador "1 / 8" (ver
 * #ob-step-label), então o nome acessível do diálogo ia virar isso, não
 * o título real do passo ("perfil", "finanças" etc.). Por isso
 * aria-labelledby="ob-title" já vai fixo no markup, apontando pro <h2>
 * de verdade. `.ob-text` com aria-live="polite" garante que trocar de
 * passo (próximo/anterior) seja anunciado ao leitor de tela mesmo sem
 * mover o foco pra fora do botão que disparou a troca; a ilustração
 * (`#ob-illus-wrap`) é puramente decorativa/redundante com o texto, daí
 * aria-hidden.
 */

let modalEl = null;
let currentStep = 0;
let marking = false;

/** Lê nome/cor atuais do perfil pra personalizar os textos do tour. */
function buildCtx() {
  const profile = store.get("profile") ?? {};
  return {
    name: profile.display_name && profile.display_name !== "usuário" ? profile.display_name : t("onboarding.voce"),
    colorLabel: accentLabel(profile.accent_color ?? "#8fbf8f"),
  };
}

// ─── Passos do tour ──────────────────────────────────────────────────────────
// Cada passo: { title(ctx), desc(ctx), illustration(ctx) -> HTMLstring }
const STEPS = [
  {
    title: (ctx) => t("onboarding.bora", { nome: ctx.name }),
    desc: () =>
      t("onboarding.essa_e_uma_previa_rapida"),
    illustration: () => `
      <div class="ob-illus ob-illus--intro">
        <div class="ob-illus-row">
          <span class="ob-xp-bar"><span class="ob-xp-fill" style="width:62%"></span></span>
          <span class="ob-level">lv 4</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${nomeAtributo("aprendizado")}</span>
          <span class="ob-attr-xp">+20 xp</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${nomeAtributo("financas")}</span>
          <span class="ob-attr-xp">+20 xp</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${nomeAtributo("metas")}</span>
          <span class="ob-attr-xp">+30 xp</span>
        </div>
      </div>`,
  },
  {
    title: () => t("nav.perfil"),
    desc: (ctx) =>
      t("onboarding.desc_perfil", { cor: ctx.colorLabel }),
    illustration: (ctx) => `
      <div class="ob-illus ob-illus--perfil">
        <div class="ob-profile-card">
          <pre class="ob-avatar">░░▒▒░░
░▒████▒░
░▒████▒░
░░▒▒░░</pre>
          <div class="ob-profile-info">
            <span class="ob-profile-name">${escapeHtml(ctx.name)}</span>
            <span class="ob-profile-sub">${t("onboarding.cor_de_destaque")} <span class="ob-accent-dot"></span></span>
          </div>
        </div>
      </div>`,
  },
  {
    title: () => t("nav.nucleo"),
    desc: () =>
      t("onboarding.o_coracao_da_gamificacao_5"),
    illustration: () => `
      <div class="ob-illus ob-illus--nucleo">
        <div class="ob-nucleo-attrs">
          ${["carreira", "financas", "aprendizado", "organizacao", "metas"]
            .map((a, i) => {
              const pct = [38, 72, 55, 20, 84][i];
              return `<div class="ob-attr-line">
              <span class="ob-attr-name">${nomeAtributo(a)}</span>
              <span class="ob-mini-bar"><span class="ob-mini-fill" style="width:${pct}%"></span></span>
              <span class="ob-lv">lv${[2, 5, 3, 1, 7][i]}</span>
            </div>`;
            })
            .join("")}
          <div class="ob-attr-row" style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border-soft);">
            <span class="ob-attr">${icon("check", { size: 9 })} ${t("onboarding.concluiu", { nome: t("onboarding.fundamentos_de_python") })}</span>
            <span class="ob-attr-xp">+20 xp</span>
          </div>
        </div>
      </div>`,
  },
  {
    title: () => t("nav.financas"),
    desc: () =>
      t("onboarding.renda_recorrente_com_cadastro_proprio"),
    illustration: () => `
      <div class="ob-illus ob-illus--financas">
        <div class="ob-fin-row">
          <span class="ob-fin-label">${t("onboarding.entradas")}</span>
          <span class="ob-fin-val ob-fin-pos">+ R$ 3.100</span>
        </div>
        <div class="ob-fin-row">
          <span class="ob-fin-label">${t("onboarding.saidas")}</span>
          <span class="ob-fin-val ob-fin-neg">− R$ 1.840</span>
        </div>
        <div class="ob-fin-divider"></div>
        <div class="ob-fin-row">
          <span class="ob-fin-label">${t("onboarding.saldo")}</span>
          <span class="ob-fin-val ob-fin-pos">R$ 1.260</span>
        </div>
        <div class="ob-fin-next">${t("onboarding.prox_salario")} <span class="ob-fin-date">${fmtDataCurta("2000-08-05")}</span></div>
      </div>`,
  },
  {
    title: () => "aprendizado",
    desc: () =>
      t("onboarding.trilhas_de_estudo_com_marcos"),
    illustration: () => `
      <div class="ob-illus ob-illus--aprendizado">
        <div class="ob-track-header">
          <span class="ob-track-name">${t("onboarding.programacao")}</span>
          <span class="ob-track-pct">67%</span>
        </div>
        <div class="ob-track-bar"><span class="ob-track-fill" style="width:67%"></span></div>
        <div class="ob-milestones">
          <div class="ob-milestone ob-ms-done">${icon("check", { size: 9 })} ${t("onboarding.fundamentos_de_python")}</div>
          <div class="ob-milestone ob-ms-done">${icon("check", { size: 9 })} ${t("onboarding.fastapi_rotas_e_modelos")}</div>
          <div class="ob-milestone">  ${t("onboarding.sqlite_sem_orm")}</div>
          <div class="ob-milestone ob-ms-faint">  ${t("onboarding.testes_com_pytest")}</div>
        </div>
      </div>`,
  },
  {
    title: () => t("nav.organizacao"),
    desc: () =>
      t("onboarding.desc_organizacao"),
    illustration: () => `
      <div class="ob-illus ob-illus--org">
        <div class="ob-org-row">
          <span class="ob-org-icon">${icon("link", { size: 11 })}</span>
          <span class="ob-org-label">github.com/usuario/kami</span>
        </div>
        <div class="ob-org-row">
          <span class="ob-org-icon">${icon("mail", { size: 11 })}</span>
          <span class="ob-org-label">${t("onboarding.3_mensagens_nao_lidas")}</span>
        </div>
        <div class="ob-email-preview">
          <span class="ob-email-from">dev@lista.org</span>
          <span class="ob-email-subj">${t("onboarding.release_v0_9_disponivel")}</span>
        </div>
      </div>`,
  },
  {
    title: () => t("nav.metas"),
    desc: () =>
      t("onboarding.metas_financeiras_tipo_aquela_viagem"),
    illustration: () => `
      <div class="ob-illus ob-illus--metas">
        <div class="ob-meta-card">
          <span class="ob-meta-title">${t("onboarding.viagem_para_o_japao")}</span>
          <div class="ob-meta-bar"><span class="ob-meta-fill" style="width:43%"></span></div>
          <span class="ob-meta-sub">R$ 4.300 / R$ 10.000 · vence em dez</span>
        </div>
        <div class="ob-meta-card">
          <span class="ob-meta-title">${t("onboarding.dominar_python")}</span>
          <div class="ob-meta-bar"><span class="ob-meta-fill" style="width:67%"></span></div>
          <span class="ob-meta-sub">${t("onboarding.trilha_programacao_avanca_sozinha")}</span>
        </div>
      </div>`,
  },
  {
    title: () => t("nav.calendario"),
    desc: () =>
      t("onboarding.todo_compromisso_financeiro_contas_fixas"),
    illustration: () => `
      <div class="ob-illus ob-illus--calendario">
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${icon("receipt", { size: 9 })} ${t("onboarding.conta_de_luz")}</span>
          <span class="ob-attr-xp">${t("onboarding.venceu_ontem")}</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${icon("target", { size: 9 })} ${t("onboarding.viagem_para_o_japao")}</span>
          <span class="ob-attr-xp">${t("onboarding.vence_em_dez")}</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${icon("star", { size: 9 })} concluiu "fundamentos de python"</span>
          <span class="ob-attr-xp">${t("onboarding.ha_2_dias")}</span>
        </div>
      </div>`,
  },
  {
    title: (ctx) => t("onboarding.titulo_carreira", { nome: ctx.name }),
    desc: () =>
      t("onboarding.area_atual_e_area_meta"),
    illustration: () => `
      <div class="ob-illus ob-illus--carreira">
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${t("onboarding.area_atual_meta")}</span>
          <span class="ob-attr-xp">${t("onboarding.dev_jr_dev_pleno")}</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${icon("check", { size: 9 })} ${t("onboarding.backend_developer_acme_corp")}</span>
          <span class="ob-attr-xp">+80 xp</span>
        </div>
        <div class="ob-illus-row ob-attr-row">
          <span class="ob-attr">${icon("trending-up", { size: 9 })} ${t("onboarding.evolucao_salarial")}</span>
          <span class="ob-attr-xp">R$ 6.200</span>
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
    <div class="modal ob-modal" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <div class="modal-head">
        <span class="ob-step-label" id="ob-step-label"></span>
        <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button>
      </div>
      <div class="modal-body ob-body">
        <div class="ob-illus-wrap" id="ob-illus-wrap" aria-hidden="true"></div>
        <div class="ob-text" aria-live="polite">
          <h2 class="ob-title" id="ob-title"></h2>
          <p class="ob-desc" id="ob-desc"></p>
        </div>
      </div>
      <div class="ob-footer">
        <button type="button" class="btn ob-btn-prev" id="ob-btn-prev" style="display:none">
          ${icon("arrow-left", { size: 13 })} ${t("onboarding.anterior")}
        </button>
        <div class="ob-dots" id="ob-dots"></div>
        <button type="button" class="btn primary ob-btn-next" id="ob-btn-next">
          ${t("tip_sequence.proximo")} ${icon("arrow-right", { size: 13 })}
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

  const dotsEl = modalEl.querySelector("#ob-dots");
  dotsEl.innerHTML = STEPS.map((_, i) => `<span class="ob-dot${i === step ? " ob-dot--on" : ""}"></span>`).join("");

  const prevBtn = modalEl.querySelector("#ob-btn-prev");
  prevBtn.style.display = step === 0 ? "none" : "";

  const nextBtn = modalEl.querySelector("#ob-btn-next");
  const isLast = step === total - 1;
  nextBtn.innerHTML = isLast ? `${icon("check", { size: 13 })} ${t("onboarding.comecar")}` : `${t("tip_sequence.proximo")} ${icon("arrow-right", { size: 13 })}`;
  nextBtn.dataset.last = isLast ? "1" : "";
}

function wireModal(wrap) {
  wrap.querySelector('[data-action="close"]').addEventListener("click", () => closeOnboardingModal());
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
  modalEl = noIdiomaAtual(modalEl, buildModal);
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