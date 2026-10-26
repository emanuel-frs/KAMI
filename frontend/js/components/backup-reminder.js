/**
 * Lembrete discreto de backup — reforça uma feature que já existe
 * (export/import em configuracoes-modal.js) em vez de adicionar uma nova.
 * Kami é local-first sem nuvem: a única proteção contra perda de dados
 * é o usuário lembrar de clicar em "baixar backup" por conta própria,
 * e hoje nada no app sugere isso.
 *
 * Gatilho (ver maybeShowBackupReminder, chamado em app.js → boot()):
 *   - só depois do tour geral (onboarding_completed) — não estraga a
 *     primeira experiência de quem ainda está conhecendo o app;
 *   - e (nunca fez um export OU já faz LIMIT_DAYS desde o último).
 *
 * Não bloqueia nada (toast, não modal) e não persiste "dispensado" em
 * lugar nenhum — fechar só esconde pelo resto desta sessão do app; se
 * a condição continuar valendo, reaparece no próximo boot. De
 * propósito simples: a única forma de fazer o lembrete sumir de vez é
 * exportar um backup de verdade (o que zera last_backup_at no
 * backend).
 */
import { icon } from "./icons.js";
import { openConfiguracoesModal } from "../modals/configuracoes-modal.js";
import { noIdiomaAtual, t } from "../i18n.js";

const LIMIT_DAYS = 14;
let dismissedThisSession = false;
let toastEl = null;
let hideTimer = null;

function daysSince(isoString) {
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / (1000 * 60 * 60 * 24);
}

export function shouldShowBackupReminder(profile) {
  if (!profile || !profile.onboarding_completed) return false;
  if (dismissedThisSession) return false;
  if (!profile.last_backup_at) return true;
  return daysSince(profile.last_backup_at) >= LIMIT_DAYS;
}

function buildToast() {
  const el = document.createElement("div");
  el.className = "backup-reminder-toast";
  el.id = "backup-reminder-toast";
  // item 5 das pendências ("lembrete de backup (aria-live)"): sem isso
  // o toast aparece silenciosamente pra quem usa leitor de tela — mesmo
  // padrão polite/status já usado no toast-stack genérico (toast.js).
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "true");
  el.innerHTML = `
    ${icon("download", { size: 14 })}
    <span class="backup-reminder-text">${t("backup_reminder.faz_tempo_que_voce_nao")}</span>
    <button type="button" class="btn sm" data-action="backup">${t("backup_reminder.fazer_backup")}</button>
    <button type="button" class="backup-reminder-close" data-action="dismiss" aria-label="${t("backup_reminder.dispensar")}">${icon("x", { size: 12 })}</button>
  `;
  el.querySelector('[data-action="backup"]').addEventListener("click", () => {
    hideBackupReminder();
    openConfiguracoesModal("backup"); // pula direto pra aba de export, já que hoje o modal virou multi-aba (ver configuracoes_plano.md)
  });
  el.querySelector('[data-action="dismiss"]').addEventListener("click", () => {
    dismissedThisSession = true;
    hideBackupReminder();
  });
  document.body.appendChild(el);
  return el;
}

// O lembrete e a pilha de toasts (toast.js) moram no mesmo canto: com o
// lembrete aberto, a pilha sobe a altura dele (toast.css usa a variável)
// — antes um aviso novo aparecia por cima do lembrete.
function ocuparCanto(px) {
  document.documentElement.style.setProperty("--canto-ocupado", `${px}px`);
}

export function hideBackupReminder() {
  if (!toastEl) return;
  clearTimeout(hideTimer);
  toastEl.classList.remove("open");
  ocuparCanto(0);
}

export function maybeShowBackupReminder(profile) {
  if (!shouldShowBackupReminder(profile)) return;

  toastEl = noIdiomaAtual(toastEl, buildToast);
  // requestAnimationFrame pra garantir que o navegador já processou o
  // elemento sem a classe "open" antes de adicioná-la — senão a
  // transição de entrada (opacity/transform em base.css) não roda.
  requestAnimationFrame(() => {
    toastEl.classList.add("open");
    ocuparCanto(toastEl.offsetHeight + 10);
  });
}
