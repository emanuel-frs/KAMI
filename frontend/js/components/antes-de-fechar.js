/**
 * components/antes-de-fechar.js — "espera eu salvar" antes de fechar o app.
 *
 * ORG-01: nota editada até o último segundo não pode se perder ao fechar
 * a janela. Quem tem algo pendente registra uma função que devolve uma
 * Promise (ex.: o editor de notas manda o salvamento que estava
 * esperando a pausa na digitação); o botão de fechar da titlebar
 * (titlebar.js) chama executarAntesDeFechar() e só fecha depois — com
 * um teto de tempo, pra um backend travado não prender a janela aberta.
 *
 * Fechar pelo sistema (Alt+F4, barra de tarefas) não passa por aqui; o
 * editor de notas também guarda um rascunho local a cada tecla (só nota
 * não trancada), que é recuperado ao abrir a nota de novo.
 */
const tarefas = new Set();
const TETO_MS = 2500;

/** @param {() => Promise<unknown>|unknown} fn @returns {() => void} pra remover */
export function registrarAntesDeFechar(fn) {
  tarefas.add(fn);
  return () => tarefas.delete(fn);
}

export async function executarAntesDeFechar() {
  const todas = Promise.allSettled([...tarefas].map((fn) => Promise.resolve().then(fn)));
  await Promise.race([todas, new Promise((r) => setTimeout(r, TETO_MS))]);
}
