/**
 * Estado global mínimo. Só o que realmente precisa ser compartilhado
 * entre páginas/widgets vive aqui (perfil do usuário, hoje) — cada
 * página segue dona do próprio estado local (ver js/pages/*.js).
 *
 * Uso:
 *   import { store } from "../state/store.js";
 *   store.subscribe("profile", (profile) => { ... });
 *   store.set("profile", updatedProfile);
 */
function createStore() {
  const state = {};
  const listeners = new Map(); // key -> Set<fn>

  function get(key) {
    return state[key];
  }

  function set(key, value) {
    state[key] = value;
    (listeners.get(key) ?? new Set()).forEach((fn) => fn(value));
  }

  function subscribe(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key).delete(fn); // devolve unsubscribe
  }

  return { get, set, subscribe };
}

export const store = createStore();
