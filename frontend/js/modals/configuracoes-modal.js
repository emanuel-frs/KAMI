import { t } from "../i18n.js";
/**
 * Modal de configurações — aberto pelo ícone de engrenagem no rodapé
 * da sidebar (fora de qualquer tela, ver alinhamento de UX geral). Mesmo padrão singleton dos outros modais (ver
 * err-modal.js).
 *
 * MAN-02: este arquivo ficou só com o esqueleto (abas, abrir/fechar,
 * trocar de aba); cada aba mora em modals/configuracoes/<aba>.js e o
 * estado compartilhado (modal aberto, trava "busy") em
 * configuracoes/estado.js. A descrição das abas abaixo continua valendo.
 *
 * A partir de configuracoes_plano.md: modal com layout sidebar (lista
 * de abas à esquerda) + conteúdo à direita, inspirado nas
 * Configurações do Claude.ai mas com a linguagem visual do Kami
 * (quadrado, sem cantos arredondados). Continua sendo um modal (não
 * uma tela/rota própria) — só o conteúdo interno que ganhou abas.
 *
 * 5 abas no v1 (ver tabs() abaixo). "Aparência", "perfil", "notificações",
 * "backup e dados" e "chaves" têm implementação real. "Backup e Dados" é a mesma funcionalidade que já existia no
 * modal antigo (export/import/reset) — só mudou de lugar, sem
 * mudança de comportamento nenhuma:
 *   - exportar dados: baixa um .json com o dump completo do banco
 *     (GET /api/sistema/export)
 *   - importar dados: sobrescreve TODAS as configurações e dados
 *     atuais com o conteúdo de um .json exportado antes (POST
 *     /api/sistema/import) — mesmo padrão de CONFIRMAÇÃO do reset
 *     (digitar uma palavra pra habilitar o botão + modal de
 *     confirmação explícito antes de executar), mas com um visual
 *     diferente (.settings-warning, âmbar) em vez do vermelho da
 *     zona de perigo: é uma sobrescrita, não um apagar-tudo
 *     definitivo. O modal de confirmação final (a última etapa antes
 *     de executar) segue vermelho igual ao do reset — é ali que o
 *     alerta "isso não tem volta" realmente importa.
 *   - zona de perigo: reset completo (POST /api/sistema/reset),
 *     exige digitar a palavra "excluir" pra habilitar o botão — o
 *     backend também exige essa palavra no corpo da requisição, então
 *     a validação do frontend é conveniência de UX, não a única
 *     barreira contra um reset acidental.
 *
 * "Aparência" (nova): v1 reduzido só à troca de cor de destaque
 * (accent_color do perfil) — mesma paleta única de accent-colors.js
 * usada no onboarding (kami-intro.js), e reaproveita o mesmo estilo
 * de swatch (.ki-swatches/.ki-swatch, definido em kami-intro.css) em
 * vez de duplicar CSS. Sem botão "salvar" — clicar num swatch já
 * aplica e persiste na hora (mesmo padrão de feedback imediato do
 * onboarding).
 *
 * "Perfil" (nova): dados do usuário + visualizar/editar avatar (ver
 * configuracoes_plano.md). O widget de perfil (widgets/profile.js)
 * virou somente leitura — essa aba é agora o único lugar que edita
 * nome de exibição e avatar. Cor de destaque NÃO mora aqui (isso é
 * escopo da aba Aparência) — de propósito, essa aba não tem nenhum
 * campo de tema/cor. Avatar continua abrindo o modal dedicado
 * (avatar-modal.js, decisão 18), nome tem campo + botão salvar
 * próprios (não é feedback imediato como os swatches, já que é um
 * input de texto livre).
 *
 * "Notificações" (nova): v1 reduzido só ao FILTRO POR TIPO — quais
 * seções aparecem no modal de notificações (modals/notifications-
 * modal.js) e contam pro badge do sino da sidebar (components/
 * notification-bell.js). Dois tipos hoje, espelhando as duas seções
 * que já existem lá: "vencendo em breve" (calendário/alertas,
 * notif_alerts_enabled) e "e-mails" (notif_email_enabled). Sem botão
 * "salvar" — mesmo padrão de feedback imediato da aba Aparência,
 * cada toggle já aplica e persiste na hora. Outras preferências de
 * notificação (mute de conta de e-mail — já mora em Organização —,
 * toast/notificação nativa) ficam de fora desta leva.
 *
 * "Chaves" (nova, ver configuracoes_plano.md): cadastro/gerenciamento
 * das três credenciais de terceiro que já existiam em Organização
 * (chave de busca da tavily, token do github, conta de e-mail) —
 * mesmos endpoints/estado, só uma segunda superfície de UI. Os ícones
 * de chave/engrenagem em Organização CONTINUAM existindo em paralelo
 * (não é migração exclusiva). Ordem das seções segue a ordem de
 * pastas do card "chaves" em si (busca, github, e-mail).
 *
 * A seção de e-mail replica a lista de contas do modal "gerenciar
 * contas" de Organização (editar, deletar, marcar como padrão,
 * silenciar, sincronizar individual) só que sem modal — tudo inline
 * na própria aba, com o formulário de nova conta/edição escondido
 * atrás de um botão "+ nova conta" (mesmo padrão de toggle
 * mostrar/esconder, não um modal separado).
 */
import { getProfile } from "../api/perfil.js";
import { getGithubTokenStatus, getSearchKeyStatus } from "../api/organizacao.js";
import { openExternal } from "../components/open-external.js";
import { showErrorModal } from "./err-modal.js";
import { icon } from "../components/icons.js";
import { store } from "../state/store.js";
import { playSound } from "../components/sound.js";
import { destroyCustomSelect } from "../components/custom-select.js";
import {
  buildAparenciaPanel,
  renderAccentSwatches,
  renderIconeTema,
  renderFormatoData,
  selectFormatoData,
  renderIdioma,
  wireIdioma,
  renderMoedaEPais,
  wireMoedaEPais,
  renderEffectsOptions,
  selectEffectsMode,
  renderSoundOptions,
  saveSound,
  renderRewards,
  selectReward,
} from "./configuracoes/aparencia.js";
import { buildPerfilPanel, renderPerfilTab, wirePerfilTab } from "./configuracoes/perfil.js";
import { buildNotificacoesPanel, renderNotificacoesTab, wireNotificacoesTab } from "./configuracoes/notificacoes.js";
import {
  buildChavesPanel,
  renderGithubBadge,
  renderSearchBadge,
  loadChavesAccounts,
  closeChavesForm,
  wireChavesTab,
} from "./configuracoes/chaves.js";
import { buildSegurancaPanel, wireSegurancaTab } from "./configuracoes/seguranca.js";
import { buildAssistentePanel, wireAssistenteTab, carregarAssistente, fecharForm as fecharFormAssistente } from "./configuracoes/assistente.js";
import { buildBackupPanel, wireBackupTab } from "./configuracoes/backup.js";
import { buildSobrePanel, wireSobreTab } from "./configuracoes/sobre.js";
import { carregarCopias } from "./configuracoes/copias.js";
import { estado } from "./configuracoes/estado.js";

const tabs = () => [
  { id: "aparencia", label: t("configuracoes.aparencia"), iconName: "palette" },
  { id: "perfil", label: t("configuracoes.perfil"), iconName: "user" },
  { id: "notificacoes", label: t("configuracoes.notificacoes"), iconName: "bell" },
  { id: "chaves", label: t("configuracoes.chaves"), iconName: "key" },
  { id: "assistente", label: t("configuracoes.assistente"), iconName: "terminal" }, // IA-01
  { id: "seguranca", label: t("configuracoes.seguranca"), iconName: "shield" },
  { id: "backup", label: t("configuracoes.backup_e_dados"), iconName: "download" },
  { id: "sobre", label: t("configuracoes.sobre"), iconName: "circle-help" },
];

// abas ainda sem conteúdo funcional — mostram um placeholder em vez
// do formulário de verdade (ver cabeçalho do arquivo). Vazio nesta
// leva (todas as 5 abas já têm implementação real); a estrutura fica
// pronta pra próxima aba que precisar disso.
const PLACEHOLDER_COPY = {};

function buildTabsHtml() {
  return tabs().map(
    (t, i) => `
      <button type="button" class="cfg-tab${i === 0 ? " on" : ""}" data-tab="${t.id}">
        ${icon(t.iconName, { size: 13 })}
        <span>${t.label}</span>
      </button>`
  ).join("");
}

function buildPlaceholderPanel(tabId) {
  return `
    <div class="cfg-panel" data-panel="${tabId}">
      <div class="cfg-placeholder">
        ${icon("clock", { size: 20 })}
        <p>${PLACEHOLDER_COPY[tabId]}</p>
      </div>
    </div>`;
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "settings-modal";
  wrap.innerHTML = `
    <div class="modal cfg-modal">
      <div class="modal-head">${t("configuracoes.configuracoes")} <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body cfg-shell">
        <nav class="cfg-sidebar">${buildTabsHtml()}</nav>
        <div class="cfg-content">
          ${buildAparenciaPanel()}
          ${buildPerfilPanel()}
          ${buildNotificacoesPanel()}
          ${buildChavesPanel()}
          ${buildAssistentePanel()}
          ${buildSegurancaPanel()}
          ${buildBackupPanel()}
          ${buildSobrePanel()}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function switchTab(wrap, tabId) {
  wrap.querySelectorAll(".cfg-tab").forEach((el) =>
    el.classList.toggle("on", el.dataset.tab === tabId)
  );
  wrap.querySelectorAll(".cfg-panel").forEach((el) =>
    el.classList.toggle("on", el.dataset.panel === tabId)
  );
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) =>
    el.addEventListener("click", () => { if (!estado.busy) closeConfiguracoesModal(); })
  );
  wrap.addEventListener("click", (e) => { if (e.target === wrap && !estado.busy) closeConfiguracoesModal(); });

  wrap.querySelectorAll(".cfg-tab").forEach((el) =>
    el.addEventListener("click", () => switchTab(wrap, el.dataset.tab))
  );

  wirePerfilTab(wrap);
  wireNotificacoesTab(wrap);
  wireChavesTab(wrap);
  wireAssistenteTab(wrap); // IA-01
  wrap.querySelector("#cfg-effects").addEventListener("change", (e) => selectEffectsMode(wrap, e.target.value));
  wrap.querySelector("#cfg-formato-data").addEventListener("change", (e) => selectFormatoData(wrap, e.target.value));
  wireIdioma(wrap); // I18N-01
  wireMoedaEPais(wrap); // I18N-06
  wrap.querySelector("#cfg-sound-on").addEventListener("change", (e) => saveSound(wrap, { som_ativo: e.target.checked }));
  wrap.querySelector("#cfg-sound-groups").addEventListener("change", (e) =>
    saveSound(wrap, { [e.target.dataset.soundGroup]: e.target.checked })
  );
  const volume = wrap.querySelector("#cfg-sound-volume");
  volume.addEventListener("input", () => {
    wrap.querySelector("#cfg-sound-volume-value").textContent = volume.value;
  });
  // salva ao soltar (change), não a cada passo do arrasto (input)
  volume.addEventListener("change", () => saveSound(wrap, { som_volume: Number(volume.value) }));
  wrap.querySelector("#cfg-sound-test").addEventListener("click", () => playSound("conquista", { force: true }));
  wrap.querySelector("#cfg-titles").addEventListener("change", (e) => selectReward(wrap, "titulo", e.target.value));
  wrap.querySelector("#cfg-themes").addEventListener("change", (e) => selectReward(wrap, "tema", e.target.value));
  wireBackupTab(wrap);
  wireSegurancaTab(wrap);
  wireSobreTab(wrap);

  wrap.addEventListener("click", (e) => {
    const link = e.target.closest("[data-open-link]")?.dataset.openLink;
    if (link) openExternal(link);
  });
}

/**
 * @param {string} [tabId] - aba pra abrir já selecionada (ver tabs()).
 *   Default "aparencia" (primeira aba). backup-reminder.js passa
 *   "backup" explicitamente pra levar direto à seção de export.
 */
export async function openConfiguracoesModal(tabId = "aparencia") {
  estado.modalEl = estado.modalEl || buildModal();

  switchTab(estado.modalEl, tabs().some((t) => t.id === tabId) ? tabId : "aparencia");

  const confirmInput = estado.modalEl.querySelector("#sm-reset-confirm");
  const resetBtn = estado.modalEl.querySelector("#sm-reset-btn");
  const exportStatusEl = estado.modalEl.querySelector("#sm-export-status");
  confirmInput.value = "";
  resetBtn.disabled = true;
  exportStatusEl.textContent = "";
  exportStatusEl.classList.remove("settings-status--visible");

  const importFile = estado.modalEl.querySelector("#sm-import-file");
  const importConfirmInput = estado.modalEl.querySelector("#sm-import-confirm");
  const importBtn = estado.modalEl.querySelector("#sm-import-btn");
  const importStatusEl = estado.modalEl.querySelector("#sm-import-status");
  importFile.value = "";
  importConfirmInput.value = "";
  importBtn.disabled = true;
  importStatusEl.textContent = "";
  importStatusEl.classList.remove("settings-status--visible");

  const accentStatusEl = estado.modalEl.querySelector("#cfg-accent-status");
  accentStatusEl.textContent = "";
  accentStatusEl.classList.remove("settings-status--visible");

  const nameStatusEl = estado.modalEl.querySelector("#cfg-name-status");
  nameStatusEl.textContent = "";
  nameStatusEl.classList.remove("settings-status--visible");

  const notifStatusEl = estado.modalEl.querySelector("#cfg-notif-status");
  notifStatusEl.textContent = "";
  notifStatusEl.classList.remove("settings-status--visible");

  // aba chaves — fecha/reseta o form de conta de e-mail (volta pro
  // estado colapsado "+ nova conta") e limpa os campos de token/chave
  // a cada abertura (mesmo padrão defensivo do resto do modal: nada de
  // valor/erro de uma sessão anterior sobrevivendo pra próxima
  // abertura).
  closeChavesForm(estado.modalEl);
  ["cfg-gh-token-input", "cfg-search-key-input"].forEach((id) => (estado.modalEl.querySelector("#" + id).value = ""));
  ["cfg-gh-token-error", "cfg-search-key-error"].forEach((id) => {
    estado.modalEl.querySelector("#" + id).style.display = "none";
  });

  estado.modalEl.classList.add("open");
  if (tabId === "backup") carregarCopias(estado.modalEl); // CONF-08 (aberto direto na aba, sem o clique)
  // IA-01: formulário de provedor nunca sobrevive de uma abertura pra outra
  // (chave digitada pela metade); aberta direto na aba, carrega sem o clique
  fecharFormAssistente(estado.modalEl);
  if (tabId === "assistente") carregarAssistente(estado.modalEl);

  // busca o perfil atual toda vez que o modal abre — pode ter mudado
  // desde a última abertura (accent_color, nome, avatar), e tanto os
  // swatches de aparência quanto a aba perfil precisam refletir o
  // estado real, não um valor cacheado da primeira vez que o modal foi
  // construído.
  try {
    const profile = await getProfile();
    renderAccentSwatches(estado.modalEl, profile.accent_color);
    renderEffectsOptions(estado.modalEl, profile.efeitos_visuais);
    renderFormatoData(estado.modalEl, profile.formato_data);
    renderIdioma(estado.modalEl);
    renderMoedaEPais(estado.modalEl, profile);
    renderIconeTema(estado.modalEl, profile);
    renderSoundOptions(estado.modalEl, profile);
    renderRewards(estado.modalEl, profile);
    renderPerfilTab(estado.modalEl, profile);
    renderNotificacoesTab(estado.modalEl, profile);
    // getProfile() aqui é a fonte mais fresca (pode ter mudado desde a
    // última abertura por outro caminho) — mantém o store sincronizado
    // igual aos outros dados de perfil, pra quem lê store.get("profile")
    // fora deste modal (notification-bell.js, notifications-modal.js).
    store.set("profile", profile);
  } catch (err) {
    showErrorModal(err.message, t("configuracoes.erro_ao_carregar_dados_de"));
  }

  // idem pro status das duas credenciais com badge (token do github e
  // chave de busca) e pra lista de contas de e-mail — mesma lógica de
  // organizacao.js: pode ter mudado desde a última abertura, inclusive
  // se cadastrada/editada pelos ícones de organização em vez desta aba.
  try {
    const [ghStatus, searchStatus] = await Promise.all([getGithubTokenStatus(), getSearchKeyStatus()]);
    renderGithubBadge(estado.modalEl, ghStatus.configured);
    renderSearchBadge(estado.modalEl, searchStatus.configured);
  } catch (err) {
    showErrorModal(err.message, t("configuracoes.erro_ao_carregar_status_das"));
  }
  await loadChavesAccounts(estado.modalEl);
}

// I18N-01: o modal é montado uma vez e reaproveitado — trocou o idioma, ele
// é jogado fora e montado de novo (se estava aberto, reabre na mesma aba)
if (typeof window !== "undefined") {
  window.addEventListener("kami:idioma", () => {
    const el = estado.modalEl;
    if (!el) return;
    const aberto = el.classList.contains("open");
    const aba = el.querySelector(".cfg-tab.on")?.dataset.tab;
    el.querySelectorAll("select").forEach(destroyCustomSelect);
    el.remove();
    estado.modalEl = null;
    if (aberto) openConfiguracoesModal(aba);
  });
}

export function closeConfiguracoesModal() {
  estado.modalEl?.classList.remove("open");
}
