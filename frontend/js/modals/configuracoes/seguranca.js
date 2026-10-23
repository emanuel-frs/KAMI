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
        <h4>PIN pra abrir o app</h4>
        <p class="settings-desc">com o PIN ligado, o kami pede um código de 4 a 8 dígitos sempre que abre — e nenhum dado sai do app antes disso.</p>
        <p class="settings-note">o PIN protege a <strong>abertura do app</strong>: não cifra o arquivo do banco e não protege contra um programa rodando no seu usuário.</p>
        <div id="cfg-pin">verificando…</div>
      </div>
      <div class="settings-section">
        <h4>senhas salvas</h4>
        <p class="settings-desc">a senha de app do e-mail, o token do github e a chave da busca ficam cifrados no banco. a chave que abre esses dados fica:</p>
        <p class="cfg-seg-chave" id="cfg-seg-chave">verificando…</p>
        <p class="settings-status" id="cfg-seg-status"></p>
        <p class="settings-note">a chave não vai junto quando a pasta de dados é copiada pra outro computador — lá, essas senhas precisam ser informadas de novo. pra levar tudo, use o backup <strong>com senha</strong> (backup e dados).</p>
      </div>
      <div class="settings-section settings-danger" id="cfg-seg-redefinir" hidden>
        <h4>redefinir a chave</h4>
        <p class="settings-desc" id="cfg-seg-redefinir-desc"></p>
        <div class="field">
          <label for="cfg-seg-confirm">digite <strong>${REDEFINIR_WORD}</strong> pra habilitar o botão abaixo</label>
          <input type="text" id="cfg-seg-confirm" placeholder="${REDEFINIR_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm danger" id="cfg-seg-redefinir-btn" disabled>redefinir chave</button>
        </div>
      </div>
    </div>`;
}

// ── PIN (SEG-02) ───────────────────────────────────────────────────────
const PIN_INPUT = (id, label) =>
  `<div class="field"><label for="${id}">${label}</label><input type="password" id="${id}" inputmode="numeric" autocomplete="off" maxlength="8"></div>`;

function pinDesligadoHtml() {
  return `
    ${PIN_INPUT("cfg-pin-novo", "PIN (4 a 8 dígitos)")}
    ${PIN_INPUT("cfg-pin-novo2", "repita o PIN")}
    <div class="form-actions"><button class="btn sm" data-pin-acao="ligar">ligar PIN</button></div>
    <p class="settings-status" id="cfg-pin-status"></p>`;
}

function pinLigadoHtml(estado) {
  const opcoes = [[null, "desligado"], [5, "5 min"], [15, "15 min"], [30, "30 min"]];
  return `
    <p class="cfg-seg-chave" data-local="cofre">${icon("check", { size: 12 })} ligado — o kami pede o PIN ao abrir.</p>
    <div class="field">
      <span class="cfg-pin-label" id="cfg-pin-inat-label">bloquear de novo depois de um tempo sem uso</span>
      <div class="cfg-pin-inat" role="group" aria-labelledby="cfg-pin-inat-label">
        ${opcoes.map(([v, t]) => `<button type="button" class="btn sm" data-inat="${v ?? ""}" aria-pressed="${(estado.inatividade_min ?? null) === v}">${t}</button>`).join("")}
      </div>
    </div>
    <div class="form-actions"><button class="btn sm" data-pin-acao="bloquear">bloquear agora</button></div>
    <details class="cfg-pin-mais">
      <summary>trocar o PIN</summary>
      ${PIN_INPUT("cfg-pin-atual", "PIN atual")}
      ${PIN_INPUT("cfg-pin-troca", "PIN novo")}
      ${PIN_INPUT("cfg-pin-troca2", "repita o PIN novo")}
      <div class="form-actions"><button class="btn sm" data-pin-acao="trocar">trocar PIN</button></div>
    </details>
    <details class="cfg-pin-mais">
      <summary>desligar o PIN</summary>
      ${PIN_INPUT("cfg-pin-atual-off", "PIN atual")}
      <div class="form-actions"><button class="btn sm danger" data-pin-acao="desligar">desligar PIN</button></div>
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
  if (!/^[0-9]{4,8}$/.test(a)) return "o PIN tem de 4 a 8 dígitos (só números)";
  if (a !== b) return "os dois PINs não são iguais";
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
        <div class="form-actions"><button class="btn sm" data-pin-acao="guardei">guardei o código</button></div>`;
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
        pinStatus(box, `${icon("check", { size: 12 })} ${res.inatividade_min ? `bloqueia depois de ${res.inatividade_min} min sem uso` : "sem bloqueio por inatividade"}`);
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
      pinStatus(box, `${icon("check", { size: 12 })} PIN trocado — o código de recuperação continua o mesmo`);
    } catch (err) {
      falhou(err);
    }
  });

  box.querySelector('[data-pin-acao="desligar"]')?.addEventListener("click", async () => {
    try {
      const res = await desativarPin(val("cfg-pin-atual-off"));
      avisarPinConfig(res);
      renderPin(wrap, res);
      pinStatus(box, `${icon("check", { size: 12 })} PIN desligado — o kami abre direto`);
    } catch (err) {
      falhou(err);
    }
  });
}

async function loadPin(wrap) {
  try {
    renderPin(wrap, await getPin());
  } catch (err) {
    wrap.querySelector("#cfg-pin").textContent = `não deu pra verificar: ${err.message}`;
  }
}

function describeChave(estado) {
  if (estado.local === "cofre") {
    return `${icon("check", { size: 12 })} no cofre do sistema (${escapeHtml(estado.cofre)}) — quem copiar a pasta de dados não leva a chave junto.`;
  }
  if (estado.local === "arquivo") {
    return `<span class="cfg-seg-warn">[!]</span> num arquivo na pasta de dados — ${escapeHtml(estado.motivo || "o sistema não tem cofre")}. funciona, mas quem copiar a pasta leva a chave junto.`;
  }
  return `<span class="cfg-seg-warn">[!]</span> indisponível — ${escapeHtml(estado.motivo || "o cofre não entregou a chave")}. as senhas salvas não podem ser lidas até a chave voltar.`;
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
        ? "não há senha salva agora, então nada é apagado."
        : `${n === 1 ? "a senha salva é apagada" : `as ${n} senhas salvas são apagadas`} e precisa${n === 1 ? "" : "m"} ser informada${n === 1 ? "" : "s"} de novo em configurações › chaves.`;
    wrap.querySelector("#cfg-seg-redefinir-desc").textContent =
      `se o cofre não vai mais devolver a chave (outro computador, outro ambiente gráfico, cofre apagado), dá pra criar uma chave nova. ${perda} o resto dos dados não muda.`;
  } catch (err) {
    el.textContent = `não deu pra verificar: ${err.message}`;
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
      status.innerHTML = `${icon("check", { size: 12 })} chave nova criada${res.segredos_apagados ? ` — informe de novo em configurações › chaves ${res.segredos_apagados === 1 ? "a senha apagada" : `as ${res.segredos_apagados} senhas apagadas`}` : ""}.`;
      status.classList.add("settings-status--visible");
      await loadSeguranca(wrap);
    } catch (err) {
      showErrorModal(err.message, "não deu pra redefinir a chave");
      btn.disabled = false;
    }
  });
}
