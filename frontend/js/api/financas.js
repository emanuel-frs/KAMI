import { get, post, put, del } from "./client.js";

// renda recorrente
export const getIncomeEntries = (month) => get(`/api/financas/income-entries?month=${month}`);
export const confirmIncomeEntry = (entryId, paidDate) =>
  put(`/api/financas/income-entries/${entryId}/confirm`, { paid_date: paidDate });
export const revertIncomeEntry = (entryId) =>
  put(`/api/financas/income-entries/${entryId}/revert`, {});

// cartões
export const listCreditCards = () => get("/api/financas/credit-cards");
export const createCreditCard = (data) => post("/api/financas/credit-cards", data);
export const deleteCreditCard = (cardId) => del(`/api/financas/credit-cards/${cardId}`);

// contas fixas
export const listFixedBills = () => get("/api/financas/fixed-bills");
export const createFixedBill = (data) => post("/api/financas/fixed-bills", data);
export const deleteFixedBill = (billId) => del(`/api/financas/fixed-bills/${billId}`);

// dívidas
export const listDebts = () => get("/api/financas/debts");
export const createDebt = (data) => post("/api/financas/debts", data);
export const updateDebt = (debtId, data) => put(`/api/financas/debts/${debtId}`, data);
export const deleteDebt = (debtId) => del(`/api/financas/debts/${debtId}`);

// assinaturas
export const listSubscriptions = () => get("/api/financas/subscriptions");
export const createSubscription = (data) => post("/api/financas/subscriptions", data);
export const deleteSubscription = (subId) => del(`/api/financas/subscriptions/${subId}`);

// transações + resumo
export const listTransactions = (month) => get(`/api/financas/transactions?month=${month}`);
export const createTransaction = (data) => post("/api/financas/transactions", data);
export const getSummary = (month) => get(`/api/financas/summary?month=${month}`);
