/**
 * components/pais.js — país e moeda padrão de uma instalação nova (I18N-06).
 *
 * O país (feriados do dia útil, P-95) vem da região do sistema
 * (`navigator.languages`: "en-GB" → GB). Sem região ("en"), o país mais
 * comum da língua (decidido pelo Emanuel, 2026-10-26); língua fora dos 10
 * idiomas → Brasil, como o idioma, que cai no português. A moeda (P-94)
 * vem do país. Quem já usava ficou com BR/BRL (migração do backend).
 *
 * Funções puras (testadas em tests/frontend/pais.test.js).
 */

const PAIS_DA_LINGUA = { pt: "BR", en: "US", es: "ES", fr: "FR", it: "IT", de: "DE", zh: "CN", ja: "JP", ko: "KR", hi: "IN" };
const PAIS_RESERVA = "BR";

// euro: membros da zona do euro e quem usa o euro sem ser membro
const EURO = "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MC MT NL PT SI SK AD SM VA ME XK".split(" ");
const MOEDA_DO_PAIS = {
  AO: "AOA", AR: "ARS", AU: "AUD", BB: "BBD", BG: "BGN", BJ: "XOF", BR: "BRL", BY: "BYN", CA: "CAD",
  CH: "CHF", CI: "XOF", CL: "CLP", CN: "CNY", CO: "COP", CZ: "CZK", DK: "DKK", DZ: "DZD", GB: "GBP",
  GE: "GEL", GG: "GBP", HK: "HKD", HU: "HUF", IL: "ILS", IN: "INR", IS: "ISK", JP: "JPY", KE: "KES",
  KR: "KRW", KY: "KYD", KZ: "KZT", MG: "MGA", MH: "USD", MX: "MXN", MY: "MYR", MZ: "MZN", NG: "NGN",
  NO: "NOK", NZ: "NZD", PA: "PAB", PH: "PHP", PL: "PLN", PY: "PYG", QA: "QAR", RO: "RON", RS: "RSD",
  RU: "RUB", SE: "SEK", SG: "SGD", ST: "STN", SV: "USD", TN: "TND", TR: "TRY", TW: "TWD", UA: "UAH",
  US: "USD", ZA: "ZAR", PE: "PEN", UY: "UYU", BO: "BOB", VE: "VES", EC: "USD", ID: "IDR", TH: "THB",
  VN: "VND", EG: "EGP", SA: "SAR", AE: "AED", PK: "PKR", BD: "BDT",
};

/** O país do sistema (ISO 3166, 2 letras). */
export function paisDoSistema(preferidos = (typeof navigator !== "undefined" && navigator.languages) || []) {
  for (const p of preferidos) {
    try {
      const regiao = new Intl.Locale(p).region;
      if (regiao && /^[A-Z]{2}$/.test(regiao)) return regiao;
    } catch {
      /* etiqueta inválida: tenta a próxima */
    }
  }
  const lingua = String(preferidos[0] || "").toLowerCase().split(/[-_]/)[0];
  return PAIS_DA_LINGUA[lingua] || PAIS_RESERVA;
}

/** A moeda (ISO 4217) do país; desconhecido → dólar. */
export function moedaDoPais(pais) {
  const p = String(pais || "").toUpperCase();
  if (EURO.includes(p)) return "EUR";
  return MOEDA_DO_PAIS[p] || "USD";
}
