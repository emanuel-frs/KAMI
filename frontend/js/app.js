import { getProfile } from "./api/perfil.js";
import { store } from "./state/store.js";
import { ApiError } from "./api/client.js";
import { fitAsciiText } from "./widgets/ascii.js";

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
    document.getElementById("sidebar-tagline").textContent = profile.display_name;
    if (profile.avatar_ascii) {
      const sidebarAvatarEl = document.getElementById("sidebar-avatar");
      sidebarAvatarEl.textContent = profile.avatar_ascii;
      // o avatar é gerado no modal com cols=70 (ver avatar-modal.js) — bem
      // mais largo que a sidebar (230px). Sem isso, o <pre> ignora o
      // font-size:9px fixo do .mini-avatar (não há CSS que force wrap
      // num <pre> sem quebrar a arte) e estoura a largura da sidebar
      // inteira. fitAsciiText calcula um font-size que realmente cabe.
      try {
        fitAsciiText(sidebarAvatarEl, profile.avatar_ascii, {
          container: sidebarAvatarEl.parentElement, // .sidebar-footer
          maxHeight: 90,
          maxFont: 9, // nunca passa do tamanho "de design" do .mini-avatar
          minFont: 1.2,
          paddingX: 8,
          paddingY: 8,
        });
      } catch (err) {
        console.error("fitAsciiText falhou no avatar da sidebar:", err);
      }
    }
  } catch (err) {
    // backend ainda subindo ou fora do ar — não trava o boot do app,
    // só avisa no lugar onde o nome/avatar apareceriam.
    document.getElementById("sidebar-tagline").textContent =
      err instanceof ApiError ? `erro: ${err.message}` : "erro ao carregar perfil";
  }
}

async function boot() {
  wireNav();
  await loadProfile();
  await showPage("perfil"); // tela inicial
}

boot();