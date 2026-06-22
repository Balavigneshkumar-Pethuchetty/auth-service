import { Navigate, Route, Routes } from "react-router-dom";
import { KeycloakProvider, useKeycloak } from "./lib/KeycloakProvider.jsx";
import { ServicesProvider } from "./lib/services.jsx";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Upload from "./pages/Upload.jsx";
import Detail from "./pages/Detail.jsx";
import Settings from "./pages/Settings.jsx";
import Tunnel from "./pages/Tunnel.jsx";

function RequireAuth({ children }) {
  const { initialized, authenticated, keycloak } = useKeycloak();

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-900">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Connecting to Keycloak…
        </div>
      </div>
    );
  }

  if (!authenticated) {
    // Kick off Keycloak login if already initialised (SSO check came back false).
    if (keycloak) keycloak.login();
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  return (
    <KeycloakProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <ServicesProvider>
                <Layout />
              </ServicesProvider>
            </RequireAuth>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/services/:id" element={<Detail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/tunnel" element={<Tunnel />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </KeycloakProvider>
  );
}
