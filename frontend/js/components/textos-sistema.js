import { localeAtual, tOu } from "../i18n.js";
import { fmtDataCurta } from "./format.js";

/**
 * components/textos-sistema.js — o que o backend cria em português e o app
 * mostra no idioma da pessoa (I18N): conquistas do catálogo, missões,
 * títulos e temas das recompensas, registro de atividade e descrição dos
 * lançamentos que o sistema cria (backend/app/mensagens.py::Texto).
 *
 * O backend manda o texto em português (a reserva) e uma chave estável; aqui
 * se escolhe o texto do dicionário por essa chave na hora de desenhar —
 * assim trocar o idioma redesenha sem buscar nada de novo. O que a pessoa
 * escreveu (conquista personalizada, nome da conta dentro da missão) nunca
 * é traduzido. O português de cada chave é conferido contra o backend em
 * backend/tests/test_textos_sistema.py.
 */

const mascarada = (a) => a.secret && !a.unlocked;
// conquista personalizada (GAM-14) não tem chave: fica como a pessoa escreveu
const chaveConquista = (a) => (mascarada(a) ? "secreta" : a.key);

export function tituloConquista(a) {
  const chave = chaveConquista(a);
  return tOu(chave && `conquista.${chave}.titulo`, a.title);
}

export function descricaoConquista(a) {
  const chave = chaveConquista(a);
  return tOu(chave && `conquista.${chave}.descricao`, a.description ?? "");
}

/** Missão diária (`missao.dia.<tipo>` com o nome) ou semanal (`missao.semana.<tipo>`). */
export function tituloMissao(m) {
  if (!m.periodo || !m.tipo) return m.titulo;
  return tOu(`missao.${m.periodo}.${m.tipo}`, m.titulo, { nome: m.nome ?? "" });
}

/** Título de recompensa (GAM-10) pela chave; `rotulo` é o português do backend. */
export const rotuloTitulo = (chave, rotulo) => tOu(chave && `recompensa.titulo.${chave}`, rotulo);

export const rotuloTema = (chave, rotulo) => tOu(chave && `recompensa.tema.${chave}`, rotulo);

export const descricaoTema = (chave, desc) => tOu(chave && `recompensa.tema.${chave}.desc`, desc);

// variáveis que o backend grava já no jeito do português e que mudam de
// forma conforme o idioma — o resto (nomes que a pessoa deu) passa intacto
const numero = (v, opcoes) => new Intl.NumberFormat(localeAtual(), opcoes).format(Number(String(v).replace(",", ".")));
const FORMATOS = {
  dia: (v) => {
    const [d, m] = String(v).split("/");
    return d && m ? fmtDataCurta(`2000-${m}-${d}`) : v;
  },
  pct: (v) => numero(v, { signDisplay: "always", minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  mult: (v) => numero(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
};

/**
 * Texto de uma linha do registro de atividade, de um lançamento ou de uma
 * ação no calendário: `{description, description_key, description_vars}`.
 * Sem chave (texto da pessoa, ou linha gravada antes da tradução) fica como
 * veio.
 */
export function textoDoRegistro({ description, description_key: chave, description_vars: vars }) {
  if (!chave) return description;
  const v = { ...(vars ?? {}) };
  for (const [nome, formatar] of Object.entries(FORMATOS)) if (v[nome] != null) v[nome] = formatar(v[nome]);
  // missão concluída: o título da missão também vai pro idioma
  if (v.missao && v.tipo) v.missao = tituloMissao({ periodo: v.periodo, tipo: v.tipo, nome: v.nome, titulo: v.missao });
  return tOu(chave, description, v);
}

/** Nome do atributo na tela ("financas" → "finanças"); atributo desconhecido sai como veio. */
export const nomeAtributo = (nome) => tOu(nome && `atributo.${nome}`, nome);
