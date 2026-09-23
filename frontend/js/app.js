import { getProfile, updateAvatar } from "./api/perfil.js";
import { store } from "./state/store.js";
import { ApiError } from "./api/client.js";
import { fitAsciiText } from "./components/ascii.js";
import { playBootSplash } from "./components/boot-splash.js";
import { icon } from "./components/icons.js";
import { openOnboardingModal } from "./modals/onboarding-modal.js";
import { openKamiIntro } from "./modals/kami-intro.js";
import { openConfiguracoesModal } from "./modals/configuracoes-modal.js";
import { openAvatarModal } from "./modals/avatar-modal.js";
import { showErrorModal } from "./modals/err-modal.js";
import { wireHelpButton } from "./modals/help-menu.js";
import { wireShortcuts } from "./components/shortcuts.js";
import { wireShortcutsHelp } from "./modals/shortcuts-help-modal.js";
import { wireGlobalShortcuts } from "./components/global-shortcuts.js";
import { wireSkipLink } from "./components/skip-link.js";
import { maybeShowBackupReminder } from "./components/backup-reminder.js";
import { wireModalEscapeClose } from "./components/modal-escape.js";
import { wireModalAccessibility } from "./components/modal-accessibility.js";
import { wireTooltips } from "./components/tooltip.js";
import { startCalendarNotifications } from "./components/calendar-notifications.js";
import { wireNotificationBell } from "./components/notification-bell.js";
import { startEmailSyncScheduler } from "./components/email-sync-scheduler.js";
import { registerNavigator } from "./components/navigate.js";

// pages/*.js: cada módulo exporta mount(container) / unmount().
// Telas do v1 (seção 0.1 do projeto) + calendário e carreira, que
// saíram do estado "em breve" (ver index.html). Assistente kami
// continua como link desabilitado (pós-mvp).
const PAGES = {
  perfil: () => import("./pages/perfil.js"),
  nucleo: () => import("./pages/nucleo.js"),
  financas: () => import("./pages/financas.js"),
  aprendizado: () => import("./pages/aprendizado.js"),
  organizacao: () => import("./pages/organizacao.js"),
  metas: () => import("./pages/metas.js"),
  calendario: () => import("./pages/calendario.js"),
  carreira: () => import("./pages/carreira.js"),
};

const pageRoot = document.getElementById("page-root");
let currentPageModule = null;
let currentPageName = null;

// teto pro requestIdleCallback — se o navegador não achar uma folga antes
// disso (pouco provável, o splash sozinho já segura uns 3s+), força o
// preload mesmo assim em vez de deixar pra nunca.
const PRELOAD_IDLE_TIMEOUT_MS = 2000;

/**
 * Pré-busca os chunks das telas ainda não visitadas, em paralelo com o
 * boot-splash. Sem isso, a primeira navegação pra cada tela paga o custo
 * de rede/parse do import() dinâmico (uns 1-2s) — daria pra cobrir com um
 * spinner, mas como o splash já segura a UI por alguns segundos no boot,
 * é tempo de sobra pra deixar tudo já baixado e em cache antes do usuário
 * clicar em qualquer coisa. Erros aqui são engolidos de propósito: é só
 * um prefetch, se falhar o import() de verdade na hora de navegar tenta
 * de novo e mostra o erro real então.
 *
 * Além do módulo em si, também dispara o preload() de dados da tela
 * (quando ela exporta um) — mesma ideia, mas esquentando o cache de GET
 * de api/client.js em vez do cache de módulos ES do navegador. Nem toda
 * tela tem um preload() ainda (as telas em grid de widgets — perfil,
 * financas, carreira — carregam cada widget sob demanda e não têm essa
 * cobertura por enquanto), então o `?.()` é o esperado, não um bug.
 */
function preloadPages(exclude) {
  Object.keys(PAGES)
    .filter((name) => name !== exclude)
    .forEach((name) => {
      PAGES[name]()
        .then((mod) => mod.preload?.())
        .catch(() => {});
    });
}

function schedulePreload(exclude) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => preloadPages(exclude), {
      timeout: PRELOAD_IDLE_TIMEOUT_MS,
    });
  } else {
    setTimeout(() => preloadPages(exclude), 300);
  }
}

/**
 * @param {string} name - chave de PAGES
 * @param {object} [opts] - repassado direto pro mount()/focus() da tela
 *   de destino (ver components/navigate.js pro motivo disso existir —
 *   hoje só pages/organizacao.js usa, pra abrir já na aba de e-mail
 *   numa mensagem específica vinda do modal de notificações).
 */
async function showPage(name, opts) {
  if (!PAGES[name]) return; // pós-mvp / link desabilitado — não faz nada

  if (name === currentPageName) {
    // já está na tela — não remonta (evitaria perder scroll/estado à
    // toa), só aplica os opts se a tela souber o que fazer com eles.
    await currentPageModule?.focus?.(opts);
    return;
  }

  currentPageModule?.unmount?.();

  document.querySelectorAll(".nav-link").forEach((el) => {
    const isActive = el.dataset.page === name;
    el.classList.toggle("active", isActive);
    // aria-current="page" em paralelo à classe, pra leitor de tela saber
    // qual item corresponde à página atual (sem afetar o visual).
    if (isActive) {
      el.setAttribute("aria-current", "page");
    } else {
      el.removeAttribute("aria-current");
    }
  });

  const mod = await PAGES[name]();
  currentPageModule = mod;
  currentPageName = name;
  await mod.mount(pageRoot, opts);
}

function wireNav() {
  document.querySelectorAll(".nav-link[data-page]").forEach((el) => {
    if (el.classList.contains("disabled")) return; // pós-mvp

    el.addEventListener("click", () => showPage(el.dataset.page));

    // acessibilidade via teclado: Enter/Space disparam a mesma navegação
    // do clique (item desabilitado fica de fora — permanece focável pelo
    // tabindex do HTML, mas não temos listener de ação nele).
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") {
        ev.preventDefault(); // evita rolar a página no Space
        showPage(el.dataset.page);
      }
    });
  });
}

function wireSettingsButton() {
  const btn = document.getElementById("btn-open-settings");
  if (!btn) return;
  btn.innerHTML = icon("settings", { size: 14 });
  btn.addEventListener("click", () => openConfiguracoesModal());
}

/**
 * Reflete o perfil atual (nome + avatar) no rodapé da sidebar. Chamada
 * uma vez no boot (loadProfile) e de novo toda vez que store.set("profile")
 * dispara — perfil pode mudar por vários caminhos (widget de perfil,
 * configurações, avatar da própria sidebar, onboarding) e a sidebar
 * precisa acompanhar todos eles, não só o carregamento inicial.
 */
function applyProfileToSidebar(profile) {
  if (!profile) return;

  const usernameEl = document.getElementById("sidebar-username");
  if (usernameEl) {
    usernameEl.textContent = profile.display_name || "usuário";
  }

  const sidebarAvatarEl = document.getElementById("sidebar-avatar");
  if (sidebarAvatarEl && profile.avatar_ascii) {
    sidebarAvatarEl.textContent = profile.avatar_ascii;
    try {
      fitAsciiText(sidebarAvatarEl, profile.avatar_ascii, {
        container: sidebarAvatarEl.parentElement,
        maxHeight: 25,
        maxFont: 3,
        minFont: 1,
        paddingX: 8,
        paddingY: 4,
      });
    } catch (err) {
      console.error("fitAsciiText falhou no avatar da sidebar:", err);
    }
  }
}

/**
 * Avatar da sidebar (decisão 18, mesmo modal do widget de perfil e da
 * aba "perfil" de configurações — 3 caminhos, 1 só modal). Clicar nele
 * abre direto o editor, sem precisar navegar até a tela perfil.
 */
function wireSidebarAvatar() {
  const el = document.getElementById("sidebar-avatar");
  if (!el) return;
  el.addEventListener("click", () => {
    const profile = store.get("profile");
    openAvatarModal({
      currentAscii: profile?.avatar_ascii,
      onSave: async (ascii) => {
        try {
          await updateAvatar(ascii);
        } catch (err) {
          showErrorModal(err.message, "erro ao salvar avatar");
          return;
        }
        store.set("profile", { ...store.get("profile"), avatar_ascii: ascii });
      },
    });
  });
}

async function loadProfile() {
  try {
    const profile = await getProfile();
    store.set("profile", profile);
    document.documentElement.style.setProperty("--accent", profile.accent_color);
  } catch (err) {
    const usernameEl = document.getElementById("sidebar-username");
    if (usernameEl) {
      usernameEl.textContent = err instanceof ApiError ? `erro: ${err.message}` : "erro ao carregar perfil";
    }
    console.warn("loadProfile falhou, mas continuamos:", err);
  }
}

async function boot() {
  // splash roda em todo boot (assinatura visual, não é gate de primeira
  // vez) — dispara em paralelo com o carregamento real, pra tela já
  // estar pronta por baixo quando ela terminar/for pulada. Essa folga
  // também é aproveitada mais abaixo pra pré-buscar as outras telas
  // (schedulePreload) enquanto o splash segura a UI.
  const splashDone = playBootSplash();

  registerNavigator(showPage);

  store.subscribe("profile", applyProfileToSidebar);

  wireSkipLink();
  wireNav();
  wireSettingsButton();
  wireSidebarAvatar();
  wireHelpButton();
  wireShortcuts();
  wireShortcutsHelp();
  wireGlobalShortcuts();
  wireNotificationBell();
  wireModalEscapeClose();
  wireModalAccessibility();
  wireTooltips();
  startCalendarNotifications({ onNavigate: (moduleName) => showPage(moduleName) });
  startEmailSyncScheduler({ onNavigate: (moduleName) => showPage(moduleName) });
  await loadProfile();
  await showPage("nucleo"); // tela inicial
  schedulePreload("nucleo"); // aproveita a folga do splash pra pré-buscar as outras telas
  await splashDone;

  const profile = store.get("profile");
  if (!profile) return;

  const isFirstRun =
    !profile.onboarding_completed &&
    (!profile.display_name || profile.display_name === "usuário") &&
    !profile.avatar_ascii;

  if (isFirstRun) {
    openKamiIntro(() => {
      openOnboardingModal();
    });
  } else if (!profile.onboarding_completed) {
    openOnboardingModal();
  } else {
    // só considera lembrar de backup fora do primeiro boot — ver
    // components/backup-reminder.js pro critério (nunca fez export,
    // ou já faz tempo desde o último).
    maybeShowBackupReminder(profile);
  }
}

boot();