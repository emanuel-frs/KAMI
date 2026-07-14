/**
 * XP_necessario(nivel) = 100 * nivel^1.3 — xp cumulativo pra passar do
 * nível N pro N+1. Portado de kami_telas_final.html (xpForLevel/levelFromXp).
 *
 * Assunção importante (marcar se o backend discordar): current_xp
 * vindo de GET /api/nucleo/attributes é tratado aqui como XP TOTAL
 * ACUMULADO daquele atributo, não "xp dentro do nível atual". Se o
 * backend usar outra convenção, o nível calculado aqui pode divergir
 * do current_level que a API devolve — nesse caso dá pra trocar esse
 * cálculo por simplesmente exibir attr.current_level direto.
 */
export function xpForLevel(level) {
  return Math.round(100 * Math.pow(level, 1.3));
}

export function levelFromXp(totalXp) {
  let level = 1;
  let remaining = totalXp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  const need = xpForLevel(level);
  const pct = Math.min(100, Math.round((remaining / need) * 100));
  return { level, pct, remaining, need };
}
