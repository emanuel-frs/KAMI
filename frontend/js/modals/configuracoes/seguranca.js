/**
 * Aba "segurança" das configurações: PIN (SEG-02) e a chave dos
 * segredos no cofre do sistema (SEG-01).
 * MAN-02: saiu de configuracoes-modal.js.
 */
import {
  ativarPin,
  definirInatividade,
  desativarPin,
  getChave,
  getPin,
  redefinirChave,
  trocarPin,
} from "../../api/seguranca.js";
import { bloquearAgora, codigoRecuperacaoHtml, wireCodigoRecuperacao } from "../../components/lock-screen.js";
import { escapeHtml } from "../../components/format.js";
import { showErrorModal } from "../err-modal.js";
import { icon } from "../../components/icons.js";
import { store } from "../../state/store.js";
import { t } from "../../i18n.js";

const REDEFINIR_WORD = "redefinir";

// ── aba segurança (SEG-01) ─────────────────────────────────────────────
// Onde está a chave que abre as senhas salvas (senha de app do e-mail,
// token do github, chave da busca): no cofre do sistema (o normal), num
// arquivo (sistema sem cofre) ou indisponível (o cofre perdeu a chave —
// aí a única saída é redefinir, apagando esses segredos). Ver app/crypto.py.
export function buildSegurancaPanel() {
  return `
    <div class="cfg-panel" data-panel="seguranca">
      <div class="settings-section" style="padding-top:0;">
        <h4>${t("seguranca.pin_pra_abrir_o_app")}</h4>
        <p class="settings-desc">${t("seguranca.com_o_pin_ligado_o")}</p>
        <p class="settings-note">${t("seguranca.nota_pin")}</p>
        <div id="cfg-pin">${t("seguranca.verificando")}</div>
      </div>
      <div class="settings-section">
        <h4>${t("seguranca.senhas_salvas")}</h4>
        <p class="settings-desc">${t("seguranca.a_senha_de_app_do")}</p>
        <p class="cfg-seg-chave" id="cfg-seg-chave">${t("seguranca.verificando")}</p>
        <p class="settings-status" id="cfg-seg-status"></p>
        <p class="settings-note">${t("seguranca.nota_chave")}</p>
      </div>
      <div class="settings-section settings-danger" id="cfg-seg-redefinir" hidden>
        <h4>${t("seguranca.redefinir_a_chave")}</h4>
        <p class="settings-desc" id="cfg-seg-redefinir-desc"></p>
        <div class="field">
          <label for="cfg-seg-confirm">${t("geral.digite_pra_habilitar", { palavra: `<strong>${REDEFINIR_WORD}</strong>` })}</label>
          <input type="text" id="cfg-seg-confirm" placeholder="${REDEFINIR_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm danger" id="cfg-seg-redefinir-btn" disabled>${t("seguranca.redefinir_chave")}</button>
        </div>
      </div>
    </div>`;
}

// ── PIN (SEG-02) ───────────────────────────────────────────────────────
const PIN_INPUT = (id, label) =>
  `<div class="field"><label for="${id}">${label}</label><input type="password" id="${id}" inputmode="numeric" autocomplete="off" maxlength="8"></div>`;

function pinDesligadoHtml() {
  return `
    ${PIN_INPUT("cfg-pin-novo", t("seguranca.pin_4_a_8_digitos"))}
    ${PIN_INPUT("cfg-pin-novo2", t("seguranca.repita_o_pin"))}
    <div class="form-actions"><button class="btn sm" data-pin-acao="ligar">${t("seguranca.ligar_pin")}</button></div>
    <p class="settings-status" id="cfg-pin-status"></p>`;
}

function pinLigadoHtml(estado) {
  const opcoes = [[null, "desligado"], [5, "5 min"], [15, "15 min"], [30, "30 min"]];
  return `
    <p class="cfg-seg-chave" data-local="cofre">${icon("check", { size: 12 })} ${t("seguranca.ligado_o_kami_pede_o")}</p>
    <div class="field">
      <span class="cfg-pin-label" id="cfg-pin-inat-label">${t("seguranca.bloquear_de_novo_depois_de")}</span>
      <div class="cfg-pin-inat" role="group" aria-labelledby="cfg-pin-inat-label">
        ${opcoes.map(([v, t]) => `<button type="button" class="btn sm" data-inat="${v ?? ""}" aria-pressed="${(estado.inatividade_min ?? null) === v}">${t}</button>`).join("")}
      </div>
    </div>
    <div class="form-actions"><button class="btn sm" data-pin-acao="bloquear">${t("seguranca.bloquear_agora")}</button></div>
    <details class="cfg-pin-mais">
      <summary>${t("seguranca.trocar_o_pin")}</summary>
      ${PIN_INPUT("cfg-pin-atual", t("seguranca.pin_atual"))}
      ${PIN_INPUT("cfg-pin-troca", t("seguranca.pin_novo"))}
      ${PIN_INPUT("cfg-pin-troca2", t("seguranca.repita_o_pin_novo"))}
      <div class="form-actions"><button class="btn sm" data-pin-acao="trocar">${t("seguranca.trocar_pin")}</button></div>
    </details>
    <details class="cfg-pin-mais">
      <summary>${t("seguranca.desligar_o_pin")}</summary>
      ${PIN_INPUT("cfg-pin-atual-off", t("seguranca.pin_atual"))}
      <div class="form-actions"><button class="btn sm danger" data-pin-acao="desligar">${t("seguranca.desligar_pin")}</button></div>
    </details>
    <p class="settings-status" id="cfg-pin-status"></p>`;
}

function avisarPinConfig(estado) {
  window.dispatchEvent(new CustomEvent("kami:pin-config", { detail: estado }));
}

function pinStatus(box, html, erro = false) {
  const el = box.querySelector("#cfg-pin-status");
  if (!el) return;
  el.innerHTML = html;
  el.classList.add("settings-status--visible");
  el.classList.toggle("settings-status--erro", erro);
}

function validarPinNovo(a, b) {
  if (!/^[0-9]{4,8}$/.test(a)) return t("seguranca.o_pin_tem_de_4");
  if (a !== b) return t("seguranca.os_dois_pins_nao_sao");
  return "";
}

function renderPin(wrap, estado) {
  const box = wrap.querySelector("#cfg-pin");
  box.innerHTML = estado.ativo ? pinLigadoHtml(estado) : pinDesligadoHtml();
  const val = (id) => box.querySelector(`#${id}`)?.value ?? "";
  const falhou = (err) => pinStatus(box, escapeHtml(err.message), true);

  box.querySelector('[data-pin-acao="ligar"]')?.addEventListener("click", async () => {
    const erro = validarPinNovo(val("cfg-pin-novo"), val("cfg-pin-novo2"));
    if (erro) return pinStatus(box, erro, true);
    try {
      const res = await ativarPin(val("cfg-pin-novo"));
      avisarPinConfig(res);
      // ORG-05 (P-70): o backend ligou "esconder o texto" das notificações
      store.set("profile", { ...store.get("profile"), notif_ocultar_texto: true });
      const ocultar = wrap.querySelector("#cfg-ocultar-texto");
      if (ocultar) ocultar.checked = true;
      // o código aparece UMA vez — só sai daqui com o "guardei"
      box.innerHTML = `${codigoRecuperacaoHtml(res.codigo_recuperacao)}
        <div class="form-actions"><button class="btn sm" data-pin-acao="guardei">${t("seguranca.guardei_o_codigo")}</button></div>`;
      wireCodigoRecuperacao(box);
      box.querySelector('[data-pin-acao="guardei"]').addEventListener("click", () => renderPin(wrap, res));
    } catch (err) {
      falhou(err);
    }
  });

  box.querySelectorAll("[data-inat]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const res = await definirInatividade(btn.dataset.inat ? Number(btn.dataset.inat) : null);
        avisarPinConfig(res);
        renderPin(wrap, res);
        pinStatus(box, `${icon("check", { size: 12 })} ${res.inatividade_min ? t("seguranca.bloqueia_depois", { n: res.inatividade_min }) : t("seguranca.sem_bloqueio_por_inatividade")}`);
      } catch (err) {
        falhou(err);
      }
    })
  );

  box.querySelector('[data-pin-acao="bloquear"]')?.addEventListener("click", async () => {
    try {
      await bloquearAgora();
    } catch (err) {
      falhou(err);
    }
  });

  box.querySelector('[data-pin-acao="trocar"]')?.addEventListener("click", async () => {
    const erro = validarPinNovo(val("cfg-pin-troca"), val("cfg-pin-troca2"));
    if (erro) return pinStatus(box, erro, true);
    try {
      const res = await trocarPin(val("cfg-pin-atual"), val("cfg-pin-troca"));
      renderPin(wrap, res);
      pinStatus(box, `${icon("check", { size: 12 })} ${t("seguranca.pin_trocado")}`);
    } catch (err) {
      falhou(err);
    }
  });

  box.querySelector('[data-pin-acao="desligar"]')?.addEventListener("click", async () => {
    try {
      const res = await desativarPin(val("cfg-pin-atual-off"));
      avisarPinConfig(res);
      renderPin(wrap, res);
      pinStatus(box, `${icon("check", { size: 12 })} ${t("seguranca.pin_desligado")}`);
    } catch (err) {
      falhou(err);
    }
  });
}

async function loadPin(wrap) {
  try {
    renderPin(wrap, await getPin());
  } catch (err) {
    wrap.querySelector("#cfg-pin").textContent = t("seguranca.erro_verificar", { erro: err.message });
  }
}

function describeChave(estado) {
  if (estado.local === "cofre") {
    return `${icon("check", { size: 12 })} ${escapeHtml(t("seguranca.no_cofre", { cofre: estado.cofre }))}`;
  }
  if (estado.local === "arquivo") {
    return `<span class="cfg-seg-warn">[!]</span> ${escapeHtml(t("seguranca.em_arquivo", { motivo: estado.motivo || t("seguranca.o_sistema_nao_tem_cofre") }))}`;
  }
  return `<span class="cfg-seg-warn">[!]</span> ${escapeHtml(t("seguranca.indisponivel", { motivo: estado.motivo || t("seguranca.o_cofre_nao_entregou_a") }))}`;
}

async function loadSeguranca(wrap) {
  const el = wrap.querySelector("#cfg-seg-chave");
  const redefinir = wrap.querySelector("#cfg-seg-redefinir");
  try {
    const estado = await getChave();
    el.innerHTML = describeChave(estado);
    el.dataset.local = estado.local;
    redefinir.hidden = estado.local !== "indisponivel";
    const n = estado.segredos_salvos;
    const perda =
      n === 0
        ? t("seguranca.nao_ha_senha_salva_agora")
        : t("seguranca.senhas_apagadas", { n });
    wrap.querySelector("#cfg-seg-redefinir-desc").textContent =
      t("seguranca.redefinir_desc", { perda });
  } catch (err) {
    el.textContent = t("seguranca.erro_verificar", { erro: err.message });
  }
}

export function wireSegurancaTab(wrap) {
  wrap.querySelector('.cfg-tab[data-tab="seguranca"]').addEventListener("click", () => {
    loadPin(wrap);
    loadSeguranca(wrap);
  });
  const input = wrap.querySelector("#cfg-seg-confirm");
  const btn = wrap.querySelector("#cfg-seg-redefinir-btn");
  input.addEventListener("input", () => {
    btn.disabled = input.value.trim().toLowerCase() !== REDEFINIR_WORD;
  });
  btn.addEventListener("click", async () => {
    const status = wrap.querySelector("#cfg-seg-status");
    btn.disabled = true;
    try {
      const res = await redefinirChave(input.value.trim().toLowerCase());
      input.value = "";
      status.innerHTML = `${icon("check", { size: 12 })} ${escapeHtml(res.segredos_apagados ? t("seguranca.chave_nova_senhas", { n: res.segredos_apagados }) : t("seguranca.chave_nova"))}`;
      status.classList.add("settings-status--visible");
      await loadSeguranca(wrap);
    } catch (err) {
      showErrorModal(err.message, t("seguranca.nao_deu_pra_redefinir_a"));
      btn.disabled = false;
    }
  });
}
