/**
 * Gráfico de linha desenhado na largura REAL do contêiner, em pixels.
 *
 * Um svg com viewBox fixo escala junto com o widget: num card largo o
 * gráfico ficava alto demais, com a linha grossa e as bolinhas enormes (e,
 * com preserveAspectRatio="none" e altura fixa, as bolinhas viravam
 * elipses). Aqui o contêiner tem altura fixa no CSS, `desenhar(largura)`
 * devolve o <svg> já em pixels (viewBox = largura × altura) e ele é
 * redesenhado quando a largura muda — traço e raio sempre do mesmo tamanho.
 *
 * Usado pela evolução salarial (carreira) e pela evolução do saldo
 * (finanças). As barras do fluxo não precisam: retângulo esticado na
 * horizontal continua retângulo.
 */
export function desenharNaLargura(alvo, desenhar) {
  let ultima = 0;
  const atualizar = () => {
    const largura = Math.round(alvo.clientWidth);
    if (!largura || largura === ultima) return;
    ultima = largura;
    alvo.querySelector(":scope > svg")?.remove();
    alvo.insertAdjacentHTML("afterbegin", desenhar(largura));
  };
  atualizar();
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      if (!alvo.isConnected) return ro.disconnect();
      atualizar();
    });
    ro.observe(alvo);
  }
}
