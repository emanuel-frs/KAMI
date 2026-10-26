import { getProfile, updateAvatar, updateProfile } from "./api/perfil.js";
import { store } from "./state/store.js";
import { ApiError } from "./api/client.js";
import { fitAsciiText } from "./components/ascii.js";
import { playBootSplash } from "./components/boot-splash.js";
import { icon } from "./components/icons.js";
import { openOnboardingModal } from "./modals/onboarding-modal.js";
import { openKamiIntro } from "./modals/kami-intro.js";
import { openConfiguracoesModal } from "./modals/configuracoes-modal.js";
import { oferecerLayoutNovo } from "./components/layout-novidade.js";
import { garantirDesbloqueio, startInactivityLock, wireLockScreen } from "./components/lock-screen.js";
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
import { startLembretesAgendador } from "./components/lembretes-agendador.js";
import { iniciarCopiasAutomaticas } from "./components/copias-automaticas.js";
import { iniciarAtualizacoes } from "./components/atualizacao.js";
import { wireBandeja } from "./components/bandeja.js";
import { wireNotificationBell } from "./components/notification-bell.js";
import { startEmailSyncScheduler } from "./components/email-sync-scheduler.js";
import { startProgressWatcher } from "./components/progress-watcher.js";
import { wireVisualEffects } from "./components/visual-effects.js";
import { pageEnter, wireEffectSkip } from "./components/fx.js";
import { wirePixelCursor } from "./components/pixel-cursor.js";
import { restaurarAparencia, wireTheme } from "./components/tema.js";
import { wireIconeTema } from "./components/icone-tema.js";
import { playFollowUp, wireSounds } from "./components/sound.js";
import { startSidebarLevel } from "./components/sidebar-level.js";
import { startStreakNotice } from "./components/streak-notice.js";
import { startRetrospective } from "./modals/retrospectiva-modal.js";
import { registerNavigator } from "./components/navigate.js";
import { setTelaAtual, wireErrorNotice } from "./components/error-notice.js";
import { startBackendWatchdog } from "./components/backend-watchdog.js";
import { wireNotasVinculadas } from "./components/notas-vinculadas.js";
import { wirePaleta } from "./components/paleta.js";
import { definirFormatoData, formatoData } from "./components/format.js";
import { wireCamposData } from "./components/campos-data.js";
import { novaVisitaDeTela } from "./components/dicas-novas.js";
import { carregarIdioma, idiomaAtual, idiomaDoSistema, idiomaGuardado, t } from "./i18n.js";

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
  habitos: () => import("./pages/habitos.js"), // ORG-04
  carreira: () => import("./pages/carreira.js"),
};

const pageRoot = document.getElementById("page-root");
let currentPageModule = null;
let currentPageName = null;
// CONF-02: o perfil carregou no boot? (senão, a recuperação do backend
// recarrega o app inteiro em vez de só a tela)
let bootedWithBackend = false;

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
        // pré-carga é só esquenta-cache: se falhar, o mount() de verdade
        // tenta de novo e mostra o erro (e erro inesperado da API já
        // virou aviso pelo kami:api-error — CONF-01)
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
/**
 * CONF-02: remonta a tela atual de verdade (showPage ignora a tela que já
 * está aberta). Usado quando o backend volta depois de uma queda: os
 * widgets precisam buscar tudo de novo no backend novo.
 */
async function reloadCurrentPage() {
  const name = currentPageName || "nucleo";
  currentPageModule?.unmount?.();
  currentPageModule = null;
  currentPageName = null;
  await showPage(name);
}

let navegacao = 0;

async function showPage(name, opts) {
  if (!PAGES[name]) return; // pós-mvp / link desabilitado — não faz nada

  // `remontar` (ORG-03, paleta Ctrl+K): mesmo já estando na tela, monta de
  // novo — o item escolhido é entregue por foco pendente
  // (components/pending-focus.js), que só é lido ao montar
  if (name === currentPageName && !opts?.remontar) {
    // já está na tela — não remonta (evitaria perder scroll/estado à
    // toa), só aplica os opts se a tela souber o que fazer com eles.
    await currentPageModule?.focus?.(opts);
    return;
  }

  // cliques rápidos (ou a troca de idioma) podem começar outra navegação
  // enquanto esta ainda carrega o módulo: só a mais recente monta a tela
  const minha = ++navegacao;
  currentPageModule?.unmount?.();
  currentPageModule = null;
  currentPageName = null;

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
  if (minha !== navegacao) return;
  currentPageModule = mod;
  currentPageName = name;
  setTelaAtual(name); // CONF-01: entra no "copiar detalhes" e no log de erro da tela
  novaVisitaDeTela(); // MAN-05: dicas novas só ao abrir a tela, uma vez por visita
  try {
    await mod.mount(pageRoot, opts);
  } catch (err) {
    // a tela foi trocada no meio da montagem: o que ela ainda tentou
    // desenhar já não existe — erro dela não é erro da tela aberta agora
    if (minha !== navegacao) return;
    throw err;
  }
  if (minha !== navegacao) return;
  playFollowUp("navegar"); // GAM-13: quieto se veio de um clique (o clique já tocou)
  // GAM-15: cards "ligando" e títulos digitados
  // (só com efeitos "completo" e sem reduced-motion — ver components/fx.js)
  pageEnter(pageRoot);
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
/**
 * ORG-07 (P-53): formato das datas (configurações › aparência). Trocar o
 * formato remonta a tela atual, pra ela já aparecer com as datas novas.
 */
function aplicarFormatoData(profile) {
  if (!profile) return;
  const antes = formatoData();
  definirFormatoData(profile.formato_data);
  if (formatoData() !== antes && currentPageName) showPage(currentPageName, { remontar: true });
}

/**
 * I18N-01: o idioma do perfil manda. Banco novo (idioma vazio) fica com o
 * que a abertura escolheu pelo sistema, e grava — a partir daí é a escolha
 * da pessoa. Perfil com outro idioma (trocado em configurações, ou backup
 * de outra máquina importado) carrega o dicionário e redesenha.
 */
async function aplicarIdiomaDoPerfil(profile) {
  if (!profile) return;
  if (!profile.idioma) {
    try {
      store.set("profile", await updateProfile({ idioma: idiomaAtual() }));
    } catch {
      /* fica pra próxima abertura */
    }
    return;
  }
  if (profile.idioma !== idiomaAtual()) await carregarIdioma(profile.idioma);
}

/** Trocou o idioma: textos fixos já foram (i18n.js); falta o resto. */
function aoTrocarIdioma() {
  applyProfileToSidebar(store.get("profile"));
  enviarTextosDaBandeja();
  if (currentPageName) showPage(currentPageName, { remontar: true });
}

/** O menu da bandeja é montado pelo Rust; os textos vão daqui (I18N-01). */
function enviarTextosDaBandeja() {
  window.__TAURI__?.core
    ?.invoke("janela_textos_bandeja", { abrir: t("bandeja.abrir"), captura: t("bandeja.captura"), sair: t("bandeja.sair") })
    .catch(() => {});
}

function applyProfileToSidebar(profile) {
  if (!profile) return;

  const usernameEl = document.getElementById("sidebar-username");
  if (usernameEl) {
    usernameEl.textContent = profile.display_name && profile.display_name !== "usuário" ? profile.display_name : t("perfil.usuario");
  }

  const sidebarAvatarEl = document.getElementById("sidebar-avatar");
  // sem avatar: o aviso quebra linha como texto normal (o <pre> do desenho
  // ASCII cortava em "sem avatar ainda — con", LAY-01)
  sidebarAvatarEl?.classList.toggle("mini-avatar--vazio", !profile.avatar_ascii);
  if (sidebarAvatarEl && !profile.avatar_ascii) sidebarAvatarEl.textContent = t("sidebar.sem_avatar");
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
          showErrorModal(err.message, t("perfil.erro_salvar_avatar"));
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
      // erro de conexão (status 0) traz a mensagem longa do Tauri — ela
      // vai pro modal abaixo, o sidebar só recebe um rótulo curto
      usernameEl.textContent = err instanceof ApiError && err.status === 0
        ? t("perfil.backend_offline")
        : err instanceof ApiError ? t("perfil.erro", { erro: err.message }) : t("perfil.erro_carregar");
    }
    console.warn("loadProfile falhou, mas continuamos:", err);
    // status 0 = sem conexão com o backend. Antes (até a 1.9) abria um
    // modal com o motivo; agora (CONF-02) o vigia do backend recebe o
    // mesmo erro pelo kami:api-error, tenta reiniciar sozinho uma vez e,
    // se não der, mostra a faixa no topo com o motivo do Rust (que traz o
    // caminho do kami-backend.log) e os botões [reiniciar] [abrir pasta
    // do log].
  }
}

async function boot() {
  // cor e tema da última vez, antes de qualquer coisa aparecer (o perfil
  // só chega depois — e com o PIN ligado, só depois do desbloqueio)
  restaurarAparencia();
  // I18N-01: o idioma antes de qualquer texto (a tela de PIN vem antes do
  // perfil): o da última vez ou, na primeira abertura, o do sistema
  await carregarIdioma(idiomaGuardado() || idiomaDoSistema());
  window.addEventListener("kami:idioma", aoTrocarIdioma);
  enviarTextosDaBandeja();

  // splash roda em todo boot (assinatura visual, não é gate de primeira
  // vez) — dispara em paralelo com o carregamento real, pra tela já
  // estar pronta por baixo quando ela terminar/for pulada. Essa folga
  // também é aproveitada mais abaixo pra pré-buscar as outras telas
  // (schedulePreload) enquanto o splash segura a UI.
  const splashDone = playBootSplash();

  registerNavigator(showPage);

  store.subscribe("profile", applyProfileToSidebar);
  store.subscribe("profile", aplicarFormatoData); // ORG-07
  store.subscribe("profile", aplicarIdiomaDoPerfil); // I18N-01
  wireCamposData(); // ORG-07: campo de data vazio parece vazio (WebKitGTK)
  wireVisualEffects();
  wireEffectSkip(); // GAM-15: clique/tecla durante uma animação encerra tudo
  wirePixelCursor(); // GAM-15: cursor em pixel art na cor de destaque
  wireTheme(); // GAM-10: tema de terminal liberado por nível
  wireIconeTema(); // ICO-01: ícone do app na cor de destaque (opcional)
  wireSounds(); // GAM-13: bipes 8-bit (começam ligados)

  wireSkipLink();
  // CONF-01: primeiro de tudo — qualquer erro daqui pra frente já tem aviso
  wireErrorNotice();
  // CONF-02: backend caiu → faixa no topo + reinício (sozinho uma vez, e
  // pelo botão depois). Ao voltar:
  //   - se o boot nunca completou (o backend já falhou na abertura): sem
  //     perfil, sem nível na sidebar, sem a foto inicial do
  //     progress-watcher — recarrega o app inteiro, que agora sobe limpo;
  //   - se o app já estava funcionando: recarrega o perfil e REMONTA a
  //     tela atual (visto no teste real: só chamar showPage não
  //     remontava, e a tela da abertura com falha ficava vazia).
  startBackendWatchdog({
    onRecovered: async () => {
      if (!bootedWithBackend) {
        window.location.reload();
        return;
      }
      await loadProfile();
      await reloadCurrentPage();
    },
  });
  // SEG-02: com o PIN ligado, nada de dado carrega antes do desbloqueio
  // (o backend também recusa: 423). Um 423 no meio do uso — o vigia
  // reiniciou o backend, que nasce bloqueado — reabre a tela.
  wireLockScreen();
  await garantirDesbloqueio();
  startInactivityLock();
  wireNav();
  wireSettingsButton();
  wireSidebarAvatar();
  wireHelpButton();
  wireShortcuts();
  wireShortcutsHelp();
  wireGlobalShortcuts();
  wireNotasVinculadas(); // ORG-01: "notas (N)" em metas/trilhas/eventos/posições
  wirePaleta(); // ORG-03: Ctrl+K, busca global e comandos
  wireNotificationBell();
  wireModalEscapeClose();
  wireModalAccessibility();
  wireTooltips();
  startCalendarNotifications({ onNavigate: (moduleName) => showPage(moduleName) });
  startLembretesAgendador(); // ORG-05
  wireBandeja();
  startEmailSyncScheduler({ onNavigate: (moduleName) => showPage(moduleName) });
  await loadProfile();
  bootedWithBackend = !!store.get("profile");
  iniciarCopiasAutomaticas(); // CONF-08: cópia semanal mesmo com o app dias aberto na bandeja
  iniciarAtualizacoes(); // DIST-01: só avisa de versão nova (e só se ligado)
  startProgressWatcher(); // depois do perfil: a foto inicial precisa do backend de pé
  startSidebarLevel();
  await showPage("nucleo"); // tela inicial
  schedulePreload("nucleo"); // aproveita a folga do splash pra pré-buscar as outras telas
  await splashDone;
  startStreakNotice(); // depois do splash: o toast "sequência salva" não pode nascer escondido

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
    // P-23: o layout padrão melhorou desde a versão que a pessoa usava?
    oferecerLayoutNovo({ recarregarTela: reloadCurrentPage });
    // GAM-12: no 1º acesso do mês novo, a retrospectiva do mês que acabou
    // abre sozinha (uma vez) — fora do onboarding, pra não empilhar telas
    startRetrospective();
  }
}

boot();