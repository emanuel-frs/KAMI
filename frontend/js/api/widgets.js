import { get } from "./client.js";

export const getCatalog = () => get("/api/widgets/catalog");