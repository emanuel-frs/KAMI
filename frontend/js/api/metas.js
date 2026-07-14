import { get, post, put, del } from "./client.js";

export const listGoals = (filters = {}) => {
  const params = new URLSearchParams(filters).toString();
  return get(`/api/metas/goals${params ? `?${params}` : ""}`); // filtros: type, status
};
export const createGoal = (data) => post("/api/metas/goals", data);
export const updateGoal = (goalId, data) => put(`/api/metas/goals/${goalId}`, data);
export const deleteGoal = (goalId) => del(`/api/metas/goals/${goalId}`);

export const listContributions = (goalId) => get(`/api/metas/goals/${goalId}/contributions`);
export const addContribution = (goalId, data) => post(`/api/metas/goals/${goalId}/contributions`, data);
export const deleteContribution = (contributionId) => del(`/api/metas/contributions/${contributionId}`);
