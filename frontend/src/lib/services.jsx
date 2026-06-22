import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { listServices, WS_URL } from "./api";

const ServicesContext = createContext(null);

export function ServicesProvider({ children }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const wsRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listServices();
      setServices(data);
    } catch (e) {
      // backend may still be starting; the websocket snapshot will fill in
    } finally {
      setLoading(false);
    }
  }, []);

  const applyEvent = useCallback((msg) => {
    if (msg.event === "heartbeat") {
      setServices(msg.services);
      setLoading(false);
    } else if (msg.event === "created" || msg.event === "status") {
      setServices((prev) => {
        const i = prev.findIndex((s) => s.id === msg.service.id);
        if (i >= 0) {
          const copy = [...prev];
          copy[i] = msg.service;
          return copy;
        }
        return [msg.service, ...prev];
      });
    } else if (msg.event === "deleted") {
      setServices((prev) => prev.filter((s) => s.id !== msg.id));
    }
  }, []);

  useEffect(() => {
    refresh();
    let closed = false;
    let ws;

    const connect = () => {
      ws = new WebSocket(WS_URL + "/ws/status");
      wsRef.current = ws;
      ws.onopen = () => setLive(true);
      ws.onmessage = (e) => {
        try {
          applyEvent(JSON.parse(e.data));
        } catch (_) {}
      };
      ws.onclose = () => {
        setLive(false);
        if (!closed) setTimeout(connect, 2000); // auto-reconnect
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      closed = true;
      if (ws) ws.close();
    };
  }, [refresh, applyEvent]);

  return (
    <ServicesContext.Provider value={{ services, loading, live, refresh, setServices }}>
      {children}
    </ServicesContext.Provider>
  );
}

export function useServices() {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("useServices must be used within ServicesProvider");
  return ctx;
}
