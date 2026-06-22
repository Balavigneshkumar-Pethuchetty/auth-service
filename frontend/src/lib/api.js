import axios from "axios";
import { getKeycloak } from "./keycloak.js";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000";

const client = axios.create({ baseURL: API_URL + "/api" });

// Attach the Keycloak Bearer token to every request when available.
client.interceptors.request.use(async (config) => {
  try {
    const kc = await getKeycloak();
    if (kc?.authenticated && kc.token) {
      config.headers.Authorization = `Bearer ${kc.token}`;
    }
  } catch {
    // Keycloak not initialised yet — request proceeds without auth header.
  }
  return config;
});

export const listServices = () => client.get("/config/list").then((r) => r.data);
export const serviceStatus = (id) => client.get("/config/status/" + id).then((r) => r.data);
export const setupService = (body) => client.post("/config/setup", body).then((r) => r.data);
export const deleteService = (id) => client.delete("/config/delete/" + id).then((r) => r.data);

export const uploadConfig = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return client.post("/config/upload", fd).then((r) => r.data);
};

export const getSettings = () => client.get("/config/settings").then((r) => r.data);
export const updateSettings = (body) => client.put("/config/settings", body).then((r) => r.data);
export const getInfraStatus = () => client.get("/infra/status").then((r) => r.data);
export const getMe = () => client.get("/auth/me").then((r) => r.data);

export const getTunnelRoutes = () => client.get("/tunnel/routes").then((r) => r.data);
export const addTunnelRoute = (body) => client.post("/tunnel/routes", body).then((r) => r.data);
export const updateTunnelRoute = (hostname, body) =>
  client.patch(`/tunnel/routes/${hostname}`, body).then((r) => r.data);
export const deleteTunnelRoute = (hostname) =>
  client.delete(`/tunnel/routes/${hostname}`).then((r) => r.data);

export const getKeycloakRealm = () => client.get("/keycloak/realm").then((r) => r.data);
export const getRealmFile = () => client.get("/keycloak/realm-file").then((r) => r.data);
export const saveRealmFile = (body) => client.put("/keycloak/realm-file", body).then((r) => r.data);
export const exportRealmToFile = () => client.post("/keycloak/realm-export-to-file").then((r) => r.data);
