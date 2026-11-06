/**
 * Configurações › assistente › IA no computador (IA-07a).
 *
 * O que a máquina tem (memória, disco, sistema, processador, placa de
 * vídeo quando dá pra saber), o modelo que cabe nela (backend/app/
 * assistente/local.json) e o Ollama / LM Studio deste computador:
 * conectar ("usar"), baixar com andamento e cancelar, remover (só no
 * Ollama — o LM Studio cuida dos próprios modelos, P-159). Tudo roda
 * offline; modelos pequenos erram mais (P-160), e a tela diz isso.
 *
 * IA-07b: sem o Ollama, "instalar" roda o instalador oficial conferido
 * (Linux: com a senha do sistema; Windows: assinatura da Ollama); parado,
 * "ligar"; e "desinstalar" só pro Ollama que o próprio Kami instalou.
 */
import {
  baixarModeloLocal,
  cancelarDownloadLocal,
  desinstalarOllama,
  getAndamentoLocal,
  getInstalacaoLocal,
  getLocal,
  instalarOllama,
  ligarOllama,
  removerModeloLocal,
  usarModeloLocal,
} from "../../api/assistente.js";
import { ApiError } from "../../api/client.js";
import { escapeHtml } from "../../components/format.js";
import { icon } from "../../components/icons.js";
import { localeAtual, t, tOu } from "../../i18n.js";

const POLL_MS = 1000;

let estado = null;
let poll = null;
let pollInstalacao = null;
let confirmandoRemover = null;
let aoMudar = () => {};

const gb = (n) => new Intl.NumberFormat(localeAtual(), { maximumFractionDigits: 1 }).format(n);

export function localSectionHtml() {
  return `
      <div class="settings-section">
        <h4>${t("assistente.local_ia.titulo")}</h4>
        <p class="settings-desc">${t("assistente.local_ia.desc")}</p>
        <div id="cfg-ia-local">${t("seguranca.verificando")}</div>
        <p class="settings-status" id="cfg-ia-local-status" role="status"></p>
        <p class="settings-note">${t("assistente.local_ia.nota_porta")}</p>
      </div>`;
}

function textoDoErro(err) {
  const chave = err instanceof ApiError ? err.body?.chave : null;
  return escapeHtml(chave ? tOu(chave, err.message, err.body?.vars) : err.message);
}

function status(wrap, html, erro = false) {
  const el = wrap.querySelector("#cfg-ia-local-status");
  el.innerHTML = html;
  el.classList.toggle("settings-status--visible", Boolean(html));
  el.classList.toggle("cfg-ia-falha", erro); // mesmo vermelho do resto da aba
}

function maquinaHtml(m) {
  const partes = [
    m.ram_gb != null ? t("assistente.local_ia.memoria", { gb: gb(m.ram_gb) }) : null,
    m.disco_livre_gb != null ? t("assistente.local_ia.disco", { gb: gb(m.disco_livre_gb) }) : null,
    m.sistema,
    m.processador ? `${m.processador}${m.nucleos ? ` (${t("assistente.local_ia.nucleos", { n: m.nucleos })})` : ""}` : null,
    m.gpu ? t("assistente.local_ia.placa", { nome: m.gpu.nome, gb: gb(m.gpu.vram_gb) }) : t("assistente.local_ia.placa_integrada"),
  ].filter(Boolean);
  return `<p class="cfg-ia-local-maquina">${icon("terminal", { size: 12 })} ${partes.map(escapeHtml).join(" · ")}</p>`;
}

function faixaHtml(f) {
  return t("assistente.local_ia.faixa", {
    download: gb(f.download_gb),
    disco: gb(f.disco_gb),
    ram: gb(f.ram_uso_gb),
    velocidade: t(`assistente.local_ia.velocidade.${f.velocidade}`),
  });
}

function instalado(nome) {
  return (estado.ollama.modelos || []).some((m) => m.nome === nome);
}

function botaoBaixar(f) {
  if (!estado.ollama.rodando || instalado(f.modelo) || estado.baixando?.fim === false) return "";
  return `<button type="button" class="btn sm" data-local-baixar="${escapeHtml(f.modelo)}">${icon("arrow-right", { size: 12 })} ${escapeHtml(t("assistente.local_ia.baixar", { modelo: f.modelo, gb: gb(f.download_gb) }))}</button>`;
}

function recomendacaoHtml() {
  const rec = estado.recomendacao;
  if (!rec) {
    return `<p class="cfg-seg-chave" data-local="arquivo"><span class="cfg-seg-warn">[!]</span> ${escapeHtml(t("assistente.local_ia.pouca_memoria", { gb: gb(estado.ram_min_gb) }))}</p>`;
  }
  const semEspaco = estado.maquina.disco_livre_gb != null && estado.maquina.disco_livre_gb < rec.download_gb + 1;
  const outros = estado.faixas.filter((f) => f.modelo !== rec.modelo);
  return `
    <p class="cfg-seg-chave" data-local="cofre">${icon("check", { size: 12 })} ${t("assistente.local_ia.recomendado", { modelo: `<b>${escapeHtml(rec.modelo)}</b>` })}<br><small>${escapeHtml(faixaHtml(rec))}</small></p>
    ${semEspaco ? `<p class="settings-note"><span class="cfg-seg-warn">[!]</span> ${escapeHtml(t("assistente.local_ia.sem_espaco"))}</p>` : ""}
    <div class="form-actions">${botaoBaixar(rec)}</div>
    <details class="cfg-ia-local-outros"><summary>${t("assistente.local_ia.outros")}</summary>
      <ul class="cfg-ia-local-lista">${outros
        .map((f) => `<li><b>${escapeHtml(f.modelo)}</b> <small>${escapeHtml(t("assistente.local_ia.a_partir_de", { gb: gb(f.ram_min_gb) }))}; ${escapeHtml(faixaHtml(f))}</small> ${botaoBaixar(f)}</li>`)
        .join("")}</ul>
    </details>`;
}

function andamentoHtml(b) {
  if (!b) return "";
  if (b.fim && b.status === "success") return "";
  if (b.fim) {
    const texto = b.status === "cancelado" ? t("assistente.local_ia.cancelado") : t("assistente.local_ia.falhou", { erro: b.erro || "" });
    return `<p class="settings-note">${escapeHtml(texto)}</p>`;
  }
  const pct = b.total ? Math.floor((b.feito / b.total) * 100) : 0;
  return `
    <div class="cfg-ia-local-baixando">
      <p>${escapeHtml(t("assistente.local_ia.baixando", { modelo: b.modelo }))} — ${b.total ? escapeHtml(t("assistente.local_ia.de", { feito: gb(b.feito / 1e9), total: gb(b.total / 1e9) })) : escapeHtml(b.status)}</p>
      <progress max="100" value="${pct}" aria-label="${escapeHtml(t("assistente.local_ia.baixando", { modelo: b.modelo }))}">${pct}%</progress>
      <div class="form-actions"><button type="button" class="btn sm" data-local-parar>${escapeHtml(t("geral.cancelar"))}</button></div>
    </div>`;
}

function modelosHtml() {
  const lista = estado.ollama.modelos || [];
  if (!lista.length) return `<p class="settings-note">${escapeHtml(t("assistente.local_ia.sem_modelos"))}</p>`;
  return `<ul class="cfg-ia-local-lista">${lista
    .map((m) => {
      const emUso = estado.emUso?.catalogo === "ollama" && estado.emUso?.modelo === m.nome;
      const conf = confirmandoRemover === m.nome;
      return `<li>
        <b>${escapeHtml(m.nome)}</b> · ${escapeHtml(gb(m.tamanho_gb))} GB${m.parametros ? ` · ${escapeHtml(m.parametros)}` : ""}
        ${m.ferramentas ? "" : ` <small class="cfg-seg-warn">${escapeHtml(t("assistente.local_ia.sem_ferramentas"))}</small>`}
        ${emUso ? ` <small>${icon("check", { size: 11 })} ${escapeHtml(t("assistente.local_ia.em_uso"))}</small>` : ""}
        <span class="cfg-ia-local-acoes">
          ${!emUso && m.ferramentas ? `<button type="button" class="btn sm" data-local-usar="ollama" data-modelo="${escapeHtml(m.nome)}">${escapeHtml(t("assistente.local_ia.usar"))}</button>` : ""}
          ${conf
            ? `<button type="button" class="btn sm danger" data-local-remover-sim="${escapeHtml(m.nome)}">${escapeHtml(t("assistente.local_ia.remover_sim", { gb: gb(m.tamanho_gb) }))}</button>
               <button type="button" class="btn sm" data-local-remover-nao>${escapeHtml(t("geral.cancelar"))}</button>`
            : `<button type="button" class="btn sm" data-local-remover="${escapeHtml(m.nome)}">${escapeHtml(t("assistente.local_ia.remover"))}</button>`}
        </span>
      </li>`;
    })
    .join("")}</ul>`;
}

// link oficial (vem do backend: instalar_ollama.LINKS), aberto no navegador
const linkHtml = (url) =>
  url ? `<p class="settings-note"><span class="cfg-ia-link" role="link" tabindex="0" data-open-link="${escapeHtml(url)}">${escapeHtml(url.replace(/^https:\/\//, ""))}</span></p>` : "";

const ocupado = () => estado.instalacao?.tarefa && !estado.instalacao.tarefa.fim;

function instalarHtml() {
  const inst = estado.instalacao || {};
  if (!inst.como) {
    // sem como instalar daqui: o tutorial (P-164 — o SO fica só com o passo a passo)
    const links = inst.links || {};
    const comando = inst.motivo === "sem_pkexec" && links.comando ? `<pre class="cfg-ia-local-saida">${escapeHtml(links.comando)}</pre>` : "";
    return `<p class="settings-note">${escapeHtml(t(`assistente.local_ia.instalar_tutorial.${inst.motivo || "sistema"}`))}</p>${comando}
      ${linkHtml(links.site)}`;
  }
  return `
    <p class="settings-note">${escapeHtml(t(`assistente.local_ia.instalar_como.${inst.sistema}`))}</p>
    <div class="form-actions"><button type="button" class="btn sm" data-local-instalar ${ocupado() ? "disabled" : ""}>${icon("arrow-right", { size: 12 })} ${escapeHtml(t("assistente.local_ia.instalar"))}</button></div>`;
}

function desinstalarHtml() {
  const inst = estado.instalacao || {};
  if (!inst.pelo_kami) {
    return `<p class="settings-note">${escapeHtml(t("assistente.local_ia.desinstalar_pelo_sistema"))}</p>${linkHtml(inst.links?.desinstalar)}`;
  }
  const total = (estado.ollama.modelos || []).reduce((soma, m) => soma + (m.tamanho_gb || 0), 0);
  return `
    <details class="cfg-ia-local-outros"><summary>${escapeHtml(t("assistente.local_ia.desinstalar"))}</summary>
      <label class="cfg-toggle"><input type="checkbox" id="cfg-ia-local-modelos-tambem">
        <span>${escapeHtml(t("assistente.local_ia.desinstalar_modelos", { gb: gb(total) }))}</span></label>
      <div class="form-actions"><button type="button" class="btn sm danger" data-local-desinstalar ${ocupado() ? "disabled" : ""}>${escapeHtml(t("assistente.local_ia.desinstalar"))}</button></div>
    </details>`;
}

function tarefaHtml() {
  const tarefa = estado.instalacao?.tarefa;
  if (!tarefa || (tarefa.fim && tarefa.etapa === "pronto")) return "";
  const linhas = tarefa.saida?.length ? `<pre class="cfg-ia-local-saida">${escapeHtml(tarefa.saida.join("\n"))}</pre>` : "";
  if (tarefa.fim) {
    const erro = tarefa.erro_chave ? tOu(tarefa.erro_chave, tarefa.erro) : tarefa.erro;
    return `<p class="cfg-seg-chave" data-local="indisponivel"><span class="cfg-seg-warn">[!]</span> ${escapeHtml(erro || "")}</p>${linhas}`;
  }
  const pct = tarefa.total ? Math.floor((tarefa.feito / tarefa.total) * 100) : null;
  return `
    <div class="cfg-ia-local-baixando">
      <p>${escapeHtml(t(`assistente.local_ia.etapa.${tarefa.etapa}`))}${pct != null ? ` — ${escapeHtml(t("assistente.local_ia.de", { feito: gb(tarefa.feito / 1e9), total: gb(tarefa.total / 1e9) }))}` : ""}</p>
      ${pct != null ? `<progress max="100" value="${pct}">${pct}%</progress>` : ""}
      ${linhas}
    </div>`;
}

function ollamaHtml() {
  const o = estado.ollama;
  if (o.outro_computador) {
    return `<p class="cfg-seg-chave" data-local="indisponivel"><span class="cfg-seg-warn">[!]</span> ${escapeHtml(t("assistente.local_ia.outro_computador", { url: o.url }))}</p>`;
  }
  if (o.rodando) {
    return `
      <p class="cfg-seg-chave" data-local="cofre">${icon("check", { size: 12 })} ${escapeHtml(t("assistente.local_ia.ollama_aberto", { versao: o.versao || "" }))}</p>
      ${modelosHtml()}
      ${tarefaHtml()}
      ${desinstalarHtml()}`;
  }
  if (o.instalado) {
    return `
      <p class="cfg-seg-chave" data-local="arquivo"><span class="cfg-seg-warn">[!]</span> ${escapeHtml(t("assistente.local_ia.ollama_fechado"))}</p>
      <div class="form-actions"><button type="button" class="btn sm" data-local-ligar ${ocupado() ? "disabled" : ""}>${escapeHtml(t("assistente.local_ia.ligar"))}</button></div>
      ${tarefaHtml()}
      ${desinstalarHtml()}`;
  }
  return `
    <p class="cfg-seg-chave" data-local="arquivo"><span class="cfg-seg-warn">[!]</span> ${escapeHtml(t("assistente.local_ia.ollama_ausente"))}</p>
    ${instalarHtml()}
    ${tarefaHtml()}`;
}

function lmstudioHtml() {
  const l = estado.lmstudio;
  if (!l.rodando) return `<p class="settings-note">${escapeHtml(t("assistente.local_ia.lmstudio_ausente"))}</p>`;
  return `
    <p class="cfg-seg-chave" data-local="cofre">${icon("check", { size: 12 })} ${escapeHtml(t("assistente.local_ia.lmstudio_aberto"))}</p>
    <ul class="cfg-ia-local-lista">${l.modelos
      .map((m) => {
        const emUso = estado.emUso?.catalogo === "lmstudio" && estado.emUso?.modelo === m;
        return `<li><b>${escapeHtml(m)}</b>${emUso ? ` <small>${icon("check", { size: 11 })} ${escapeHtml(t("assistente.local_ia.em_uso"))}</small>` : ` <span class="cfg-ia-local-acoes"><button type="button" class="btn sm" data-local-usar="lmstudio" data-modelo="${escapeHtml(m)}">${escapeHtml(t("assistente.local_ia.usar"))}</button></span>`}</li>`;
      })
      .join("")}</ul>
    <p class="settings-note">${escapeHtml(t("assistente.local_ia.lmstudio_modelos"))}</p>`;
}

function render(wrap) {
  const box = wrap.querySelector("#cfg-ia-local");
  box.innerHTML = `
    ${maquinaHtml(estado.maquina)}
    ${recomendacaoHtml()}
    ${andamentoHtml(estado.baixando)}
    <h5 class="cfg-ia-local-sub">Ollama</h5>
    ${ollamaHtml()}
    <h5 class="cfg-ia-local-sub">LM Studio</h5>
    ${lmstudioHtml()}`;
}

export function pararAcompanhamento() {
  clearInterval(poll);
  clearInterval(pollInstalacao);
  poll = pollInstalacao = null;
}

// IA-07b: instalar/ligar/desinstalar rodam no fundo — a tela mostra a etapa
function acompanharInstalacao(wrap) {
  clearInterval(pollInstalacao);
  let falhas = 0;
  pollInstalacao = setInterval(async () => {
    if (!wrap.isConnected) return pararAcompanhamento();
    try {
      estado.instalacao = await getInstalacaoLocal();
      falhas = 0;
    } catch {
      if (++falhas >= 5) clearInterval(pollInstalacao);
      return;
    }
    if (estado.instalacao.tarefa?.fim) {
      clearInterval(pollInstalacao);
      const tarefa = estado.instalacao.tarefa;
      await carregarLocal(wrap, estado.emUso);
      if (tarefa.etapa === "pronto") status(wrap, `${icon("check", { size: 12 })} ${escapeHtml(t(`assistente.local_ia.feito.${tarefa.acao}`))}`);
      return;
    }
    render(wrap);
  }, POLL_MS);
}

function acompanhar(wrap) {
  clearInterval(poll);
  let falhas = 0;
  poll = setInterval(async () => {
    if (!wrap.isConnected) return pararAcompanhamento();
    try {
      estado.baixando = await getAndamentoLocal();
      falhas = 0;
    } catch {
      // backend fora (o vigia reinicia): a tela volta a acompanhar ao reabrir
      if (++falhas >= 5) pararAcompanhamento();
      return;
    }
    if (estado.baixando?.fim) {
      pararAcompanhamento();
      await carregarLocal(wrap, estado.emUso);
      if (estado.baixando?.status === "success") status(wrap, `${icon("check", { size: 12 })} ${escapeHtml(t("assistente.local_ia.baixado", { modelo: estado.baixando.modelo }))}`);
      return;
    }
    render(wrap);
  }, POLL_MS);
}

/** `emUso`: {catalogo, modelo} do provedor em uso (pra marcar na lista). */
export async function carregarLocal(wrap, emUso = null) {
  try {
    estado = { ...(await getLocal()), emUso };
    render(wrap);
    if (estado.baixando && !estado.baixando.fim) acompanhar(wrap);
    if (ocupado()) acompanharInstalacao(wrap);
  } catch (err) {
    wrap.querySelector("#cfg-ia-local").innerHTML = textoDoErro(err);
  }
}

export function wireLocal(wrap, { depoisDeUsar } = {}) {
  if (depoisDeUsar) aoMudar = depoisDeUsar;
  const box = wrap.querySelector("#cfg-ia-local");
  box.addEventListener("click", async (e) => {
    const alvo = e.target.closest("button");
    if (!alvo || !estado) return;
    try {
      if (alvo.dataset.localBaixar) {
        alvo.disabled = true;
        estado.baixando = await baixarModeloLocal(alvo.dataset.localBaixar);
        render(wrap);
        acompanhar(wrap);
      } else if (alvo.hasAttribute("data-local-instalar") || alvo.hasAttribute("data-local-ligar") || alvo.hasAttribute("data-local-desinstalar")) {
        alvo.disabled = true;
        const tarefa = alvo.hasAttribute("data-local-instalar")
          ? await instalarOllama()
          : alvo.hasAttribute("data-local-ligar")
            ? await ligarOllama()
            : await desinstalarOllama(wrap.querySelector("#cfg-ia-local-modelos-tambem")?.checked ?? false);
        estado.instalacao = { ...estado.instalacao, tarefa };
        render(wrap);
        acompanharInstalacao(wrap);
      } else if (alvo.hasAttribute("data-local-parar")) {
        estado.baixando = await cancelarDownloadLocal();
      } else if (alvo.dataset.localUsar) {
        alvo.disabled = true;
        const res = await usarModeloLocal(alvo.dataset.localUsar, alvo.dataset.modelo);
        estado.emUso = { catalogo: res.provedor.catalogo, modelo: res.provedor.modelo };
        render(wrap);
        status(wrap, `${icon("check", { size: 12 })} ${escapeHtml(t("assistente.local_ia.usando", { modelo: res.provedor.modelo }))}`);
        aoMudar();
      } else if (alvo.dataset.localRemover) {
        confirmandoRemover = alvo.dataset.localRemover;
        render(wrap);
      } else if (alvo.hasAttribute("data-local-remover-nao")) {
        confirmandoRemover = null;
        render(wrap);
      } else if (alvo.dataset.localRemoverSim) {
        alvo.disabled = true;
        await removerModeloLocal(alvo.dataset.localRemoverSim);
        confirmandoRemover = null;
        await carregarLocal(wrap, estado.emUso);
        status(wrap, `${icon("check", { size: 12 })} ${escapeHtml(t("assistente.local_ia.removido"))}`);
      }
    } catch (err) {
      alvo.disabled = false;
      status(wrap, textoDoErro(err), true);
    }
  });
}
