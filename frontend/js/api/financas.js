import { get, post, put, del } from "./client.js";

// renda recorrente
export const getIncomeEntries = (month) => get(`/api/financas/income-entries?month=${month}`);
export const confirmIncomeEntry = (entryId, paidDate) =>
  put(`/api/financas/income-entries/${entryId}/confirm`, { paid_date: paidDate });
export const revertIncomeEntry = (entryId) =>
  put(`/api/financas/income-entries/${entryId}/revert`, {});

// contas fixas
export const listFixedBills = () => get("/api/financas/fixed-bills");
export const createFixedBill = (data) => post("/api/financas/fixed-bills", data);
export const deleteFixedBill = (billId) => del(`/api/financas/fixed-bills/${billId}`);

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