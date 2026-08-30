import { get, put, post, del } from "./client.js";

// perfil (área atual / área-meta) — sem XP, ver routers/carreira.py
export const getCareerProfile = () => get("/api/carreira/perfil");
export const updateCareerProfile = (data) => put("/api/carreira/perfil", data); // { area_atual?, area_meta? }

// interesses profissionais — lista livre de tags, sem XP
export const getCareerInterests = () => get("/api/carreira/interesses");
export const addCareerInterest = (tag) => post("/api/carreira/interesses", { tag });
export const deleteCareerInterest = (id) => del(`/api/carreira/interesses/${id}`);

// linha do tempo de posições — CRUD completo; criar credita XP em
// 'carreira' (marco inicial x lançamento real x retroativo — ver
// routers/carreira.py), editar/remover não mexem em XP
export const listCareerPositions = () => get("/api/carreira/posicoes");
export const createCareerPosition = (data) => post("/api/carreira/posicoes", data);
export const updateCareerPosition = (id, data) => put(`/api/carreira/posicoes/${id}`, data);
export const deleteCareerPosition = (id) => del(`/api/carreira/posicoes/${id}`);

// formação acadêmica (Parte 3) — CRUD completo; criar/editar só credita
// XP em 'carreira' na TRANSIÇÃO pra status='concluido' (escalonado por
// nível — ver NIVEL_XP em routers/carreira.py), diferente de posições
// onde o próprio registro já credita. Meta tipo 'academica' (Metas)
// vinculada a uma formação progride sozinha (binário) — sem endpoint
// próprio aqui, isso acontece no backend via sync_academic_goals.
export const listCareerEducations = () => get("/api/carreira/formacoes");
export const createCareerEducation = (data) => post("/api/carreira/formacoes", data);
export const updateCareerEducation = (id, data) => put(`/api/carreira/formacoes/${id}`, data);
export const deleteCareerEducation = (id) => del(`/api/carreira/formacoes/${id}`);

// evolução salarial (Parte 4) — CRUD completo; criar credita XP em
// 'carreira' (baseline/retroativo fixo x tempo real proporcional ao
// salto% — ver routers/carreira.py), editar/remover não mexem em XP.
// `position_id` é um vínculo opcional a uma posição de career_positions.
export const listCareerSalaryRecords = () => get("/api/carreira/salarios");
export const createCareerSalaryRecord = (data) => post("/api/carreira/salarios", data);
export const updateCareerSalaryRecord = (id, data) => put(`/api/carreira/salarios/${id}`, data);
export const deleteCareerSalaryRecord = (id) => del(`/api/carreira/salarios/${id}`);
export const getCareerSalaryStats = () => get("/api/carreira/salarios/estatisticas");
