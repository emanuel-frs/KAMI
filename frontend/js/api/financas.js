import { get, post, put, del } from "./client.js";

// renda recorrente (v2) — cadastro de fontes com CRUD completo +
// ocorrências mensais (widgets/financas-renda.js). Antes o backend só
// tinha 2 fontes fixas hardcoded, sem CRUD nenhum (item 2 do mapa de
// problemas antigo) — agora é um cadastro genérico com encadeamento.
export const listIncomeSources = () => get("/api/financas/income-sources");
export const createIncomeSource = (data) => post("/api/financas/income-sources", data);
export const updateIncomeSource = (sourceId, data) => put(`/api/financas/income-sources/${sourceId}`, data);
export const deleteIncomeSource = (sourceId) => del(`/api/financas/income-sources/${sourceId}`);

export const getIncomeEntries = (month) => get(`/api/financas/income-entries?month=${month}`);
// payload: { valor_recebido?, paid_date?, atualizar_valor_fonte? } — ver
// modals/pay-income-modal.js pra como montar isso a partir da UI. Se a
// fonte tem conta_id vinculada, gera uma transação 'entrada' real.
export const payIncomeEntry = (entryId, payload) =>
  put(`/api/financas/income-entries/${entryId}/pay`, payload || {});
export const unpayIncomeEntry = (entryId) =>
  put(`/api/financas/income-entries/${entryId}/unpay`, {});

// contas fixas — cadastro
export const listFixedBills = () => get("/api/financas/fixed-bills");
export const createFixedBill = (data) => post("/api/financas/fixed-bills", data);
export const updateFixedBill = (billId, data) => put(`/api/financas/fixed-bills/${billId}`, data);
export const deleteFixedBill = (billId) => del(`/api/financas/fixed-bills/${billId}`);

// contas fixas — instância mensal (mesmo padrão de pay/unpay de
// assinaturas, ver api/wallet.js — unificação do item 1 do mapa de
// problemas). Marcar como paga pode gerar uma transação real
// (item 6): `payload` aceita { valor_pago?, forma_pagamento?,
// gerar_transacao? } — ver modals/pay-period-modal.js pra como montar
// isso a partir da UI.
export const listFixedBillPeriods = (month) => get(`/api/financas/fixed-bills/periods?month=${month}`);
export const payFixedBillPeriod = (periodId, payload) =>
  put(`/api/financas/fixed-bills/periods/${periodId}/pay`, payload || {});
export const unpayFixedBillPeriod = (periodId) =>
  put(`/api/financas/fixed-bills/periods/${periodId}/unpay`, {});

// dívidas
export const listDebts = () => get("/api/financas/debts");
export const createDebt = (data) => post("/api/financas/debts", data);
export const updateDebt = (debtId, data) => put(`/api/financas/debts/${debtId}`, data);
export const deleteDebt = (debtId) => del(`/api/financas/debts/${debtId}`);

// transações + resumo
// payload de createTransaction agora inclui: description, amount, type
// ('entrada'|'saida'|'transferencia'), category, date, conta_id (obrigatório),
// forma_pagamento ('saldo'|'credito', só quando a conta tem os dois),
// conta_destino_id (transferência interna) OU destino_externo (transferência externa)
export const listTransactions = (month) => get(`/api/financas/transactions?month=${month}`);
export const createTransaction = (data) => post("/api/financas/transactions", data);
export const getSummary = (month) => get(`/api/financas/summary?month=${month}`);

// NOTA: listCreditCards/createCreditCard/deleteCreditCard e
// listSubscriptions/createSubscription/deleteSubscription foram REMOVIDOS
// daqui — os endpoints /credit-cards e /subscriptions antigos não existem
// mais em financas.py. A wallet (bancos/contas) e as assinaturas novas
// (com toggle pago/mês) estão em api/wallet.js.