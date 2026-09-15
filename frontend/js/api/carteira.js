import { get, post, put, del } from "./client.js";
// (arquivo novo — endpoints antigos de credit-cards/subscriptions que
// viviam em api/financas.js foram REMOVIDOS de lá; a versão nova mora
// aqui. Ver nota no financas.js sobre a limpeza.)

// bancos + contas
export const listBanks = () => get("/api/carteira/banks");
export const createBank = (data) => post("/api/carteira/banks", data);
export const updateBank = (bankId, data) => put(`/api/carteira/banks/${bankId}`, data);
export const deleteBank = (bankId) => del(`/api/carteira/banks/${bankId}`);
export const createAccount = (bankId, data) => post(`/api/carteira/banks/${bankId}/accounts`, data);
export const updateAccount = (accountId, data) => put(`/api/carteira/accounts/${accountId}`, data);
export const deleteAccount = (accountId) => del(`/api/carteira/accounts/${accountId}`);

// resumo
export const getWalletSummary = () => get("/api/carteira/summary");

// assinaturas — marcar como paga pode gerar uma transação real (item 6
// do mapa de problemas): `payload` aceita { valor_pago?, forma_pagamento?,
// gerar_transacao? } — ver modals/pay-period-modal.js.
export const listSubscriptions = () => get("/api/carteira/subscriptions");
export const createSubscription = (data) => post("/api/carteira/subscriptions", data);
export const updateSubscription = (id, data) => put(`/api/carteira/subscriptions/${id}`, data);
export const deleteSubscription = (id) => del(`/api/carteira/subscriptions/${id}`);
export const listSubscriptionPeriods = (month) =>
  get(`/api/carteira/subscriptions/periods?month=${month}`);
export const paySubscriptionPeriod = (periodId, payload) =>
  put(`/api/carteira/subscriptions/periods/${periodId}/pay`, payload || {});
export const unpaySubscriptionPeriod = (periodId) =>
  put(`/api/carteira/subscriptions/periods/${periodId}/unpay`, {});

// compras parceladas — progressão calculada por calendário + ajuste
// manual opcional (ajustarParcelasCompra: delta positivo adianta,
// negativo desfaz um adiantamento). O GET não muda mais nada no banco
// (a reserva no limite é feita inteira uma vez, na criação/edição).
export const listComprasParceladas = () => get("/api/carteira/compras-parceladas");
export const createCompraParcelada = (data) => post("/api/carteira/compras-parceladas", data);
export const updateCompraParcelada = (id, data) => put(`/api/carteira/compras-parceladas/${id}`, data);
export const deleteCompraParcelada = (id) => del(`/api/carteira/compras-parceladas/${id}`);
export const ajustarParcelasCompra = (id, delta) =>
  put(`/api/carteira/compras-parceladas/${id}/ajustar`, { delta });
// fatura mês a mês (item 3 do plano) — uma linha por compra ativa no
// mês consultado, com o nº da parcela correspondente àquele mês
// específico (calculado on the fly no backend, sem persistir nada).
export const listComprasParceladasMes = (mes) =>
  get(`/api/carteira/compras-parceladas/mes?mes=${mes}`);