import { get, post, put, del } from "./client.js";

export const listGoals = () => get("/api/metas");
export const createGoal = (payload) => post("/api/metas", payload);
export const updateGoal = (id, payload) => put(`/api/metas/${id}`, payload);
export const deleteGoal = (id) => del(`/api/metas/${id}`);
export const contributeGoal = (id, payload) => post(`/api/metas/${id}/contribute`, payload);
export const listContributions = (id) => get(`/api/metas/${id}/contributions`);