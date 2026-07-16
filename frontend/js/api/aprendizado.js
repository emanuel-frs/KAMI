import { get, post, put, del } from "./client.js";

// trilhas
export const listTracks = () => get("/api/aprendizado/tracks");
export const createTrack = (data) => post("/api/aprendizado/tracks", data);
export const updateTrack = (trackId, data) => put(`/api/aprendizado/tracks/${trackId}`, data);
export const deleteTrack = (trackId) => del(`/api/aprendizado/tracks/${trackId}`);

// marcos (milestones) de uma trilha
export const listMilestones = (trackId) => get(`/api/aprendizado/tracks/${trackId}/milestones`);
export const createMilestone = (trackId, data) =>
  post(`/api/aprendizado/tracks/${trackId}/milestones`, data);
export const updateMilestone = (milestoneId, data) =>
  put(`/api/aprendizado/milestones/${milestoneId}`, data);
export const deleteMilestone = (milestoneId) => del(`/api/aprendizado/milestones/${milestoneId}`);
export const reorderMilestones = (trackId, milestoneIds) =>
  put(`/api/aprendizado/tracks/${trackId}/milestones/reorder`, { milestone_ids: milestoneIds });
