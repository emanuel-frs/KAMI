import { get, post, put, del } from "./client.js";
// (arquivo novo — endpoints antigos de credit-cards/subscriptions que
// viviam em api/financas.js foram REMOVIDOS de lá; a versão nova mora
// aqui. Ver nota no financas.js sobre a limpeza.)

// bancos + contas
export const listBanks = () => get("/api/wallet/banks");
export const createBank = (data) => post("/api/wallet/banks", data);
export const createAccount = (bankId, data) => post(`/api/wallet/banks/${bankId}/accounts`, data);
export const updateAccount = (accountId, data) => put(`/api/wallet/accounts/${accountId}`, data);
export const deleteAccount = (accountId) => del(`/api/wallet/accounts/${accountId}`);

// resumo
export const getWalletSummary = () => get("/api/wallet/summary");

// assinaturas
export const listSubscriptions = () => get("/api/wallet/subscriptions");
export const createSubscription = (data) => post("/api/wallet/subscriptions", data);
export const listSubscriptionPeriods = (month) =>
  get(`/api/wallet/subscriptions/periods?month=${month}`);
export const paySubscriptionPeriod = (periodId, valorPago) =>
  put(`/api/wallet/subscriptions/periods/${periodId}/pay`, valorPago != null ? { valor_pago: valorPago } : {});
export const unpaySubscriptionPeriod = (periodId) =>
  put(`/api/wallet/subscriptions/periods/${periodId}/unpay`, {});

// compras parceladas — progressão calculada por calendário + ajuste
// manual opcional (ajustarParcelasCompra: delta positivo adianta,
// negativo desfaz um adiantamento). O GET não muda mais nada no banco
// (a reserva no limite é feita inteira uma vez, na criação).
export const listComprasParceladas = () => get("/api/wallet/compras-parceladas");
export const createCompraParcelada = (data) => post("/api/wallet/compras-parceladas", data);
export const deleteCompraParcelada = (id) => del(`/api/wallet/compras-parceladas/${id}`);
export const ajustarParcelasCompra = (id, delta) =>
  put(`/api/wallet/compras-parceladas/${id}/ajustar`, { delta });