/**
 * Abre uma URL externa no navegador padrão do sistema.
 *
 * Dentro do Tauri, `window.open()` puro não leva a lugar nenhum (não
 * existe uma aba de navegador pra abrir — na melhor das hipóteses
 * fica em silêncio, na pior tenta abrir uma janela do próprio
 * WebKitGTK, o que nem é permitido sem capability extra). Pra abrir
 * de verdade no navegador do sistema é preciso passar pelo plugin
 * `tauri-plugin-opener` (registrado em src-tauri/src/main.rs) através
 * da API global exposta em window.__TAURI__.opener — depende de
 * app.withGlobalTauri = true em tauri.conf.json.
 *
 * Fora do Tauri (rodando via `python3 -m http.server` durante o dev
 * no navegador), window.__TAURI__ não existe, então cai no
 * window.open normal — comportamento idêntico ao que já era.
 *
 * Precisa de "opener:allow-open-url" liberado pra http(s)://* em
 * src-tauri/capabilities/default.json, ou o Tauri barra em silêncio
 * (promise rejeitada) mesmo com o plugin registrado.
 */
export function openExternal(url) {
  const opener = window.__TAURI__?.opener;
  if (opener?.openUrl) {
    opener.openUrl(url).catch((err) => {
      console.error("openExternal: falha ao abrir via Tauri opener", err);
    });
    return;
  }
  window.open(url, "_blank");
}