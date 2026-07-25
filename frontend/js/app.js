import { getProfile } from "./api/perfil.js";
import { store } from "./state/store.js";
import { ApiError } from "./api/client.js";
import { fitAsciiText } from "./components/ascii.js";
import { openOnboardingModal } from "./modals/onboarding-modal.js";

// pages/*.js: cada módulo exporta mount(container) / unmount().
// Só as telas do v1 (seção 0.1 do projeto) entram aqui — as
// pós-mvp ficam na sidebar como link desabilitado (ver index.html).
const PAGES = {
  perfil: () => import("./pages/perfil.js"),
  nucleo: () => import("./pages/nucleo.js"),
  financas: () => import("./pages/financas.js"),
  aprendizado: () => import("./pages/aprendizado.js"),
  organizacao: () => import("./pages/organizacao.js"),
  metas: () => import("./pages/metas.js"),
};

const pageRoot = document.getElementById("page-root");
let currentPageModule = null;
let currentPageName = null;

async function showPage(name) {
  if (name === currentPageName) return;
  if (!PAGES[name]) return; // pós-mvp / link desabilitado — não faz nada

  currentPageModule?.unmount?.();

  document.querySelectorAll(".nav-link").forEach((el) => {
    el.classList.toggle("active", el.dataset.page === name);
  });

  const mod = await PAGES[name]();
  currentPageModule = mod;
  currentPageName = name;
  await mod.mount(pageRoot);
}

function wireNav() {
  document.querySelectorAll(".nav-link[data-page]").forEach((el) => {
    if (el.classList.contains("disabled")) return; // pós-mvp
    el.addEventListener("click", () => showPage(el.dataset.page));
  });
}

async function loadProfile() {
  try {
    const profile = await getProfile();
    store.set("profile", profile);
    document.documentElement.style.setProperty("--accent", profile.accent_color);

    const usernameEl = document.getElementById("sidebar-username");
    if (usernameEl) {
      usernameEl.textContent = profile.display_name || "usuário";
    }

    if (profile.avatar_ascii) {
      const sidebarAvatarEl = document.getElementById("sidebar-avatar");
      if (sidebarAvatarEl) {
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
  } catch (err) {
    const usernameEl = document.getElementById("sidebar-username");
    if (usernameEl) {
      usernameEl.textContent = err instanceof ApiError ? `erro: ${err.message}` : "erro ao carregar perfil";
    }
    console.warn("loadProfile falhou, mas continuamos:", err);
  }
}

async function boot() {
  wireNav();
  await loadProfile();
  await showPage("perfil"); // tela inicial

  // item 15.6 (decisão 25): abre sozinho só na primeira vez — depois de
  // fechado (qualquer forma), profile.js marca onboarding_completed=true
  // no backend e o app para de mostrar isso automaticamente. Reaberto
  // manualmente depois via "ver tutorial novamente" no widget de perfil.
  const profile = store.get("profile");
  if (profile && !profile.onboarding_completed) {
    openOnboardingModal();
  }
}

boot();