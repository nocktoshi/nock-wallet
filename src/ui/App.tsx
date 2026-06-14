import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SessionProvider, useSession } from "./session.js";
import { Onboarding } from "./screens/onboarding/Onboarding.js";
import { LockedScreen } from "./screens/LockedScreen.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { ReceiveScreen } from "./screens/ReceiveScreen.js";
import { SendScreen } from "./screens/SendScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { SwapScreen } from "./screens/SwapScreen.js";
import { BridgePopup } from "./screens/bridge/BridgePopup.js";
import { Spinner } from "./components/primitives.js";
import { InstallPrompt } from "./components/InstallPrompt.js";

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <div className="app-frame">
          <Gate />
        </div>
      </BrowserRouter>
    </SessionProvider>
  );
}

function Gate() {
  const { status } = useSession();
  const { pathname } = useLocation();

  // Bridge popup mode (opened by a dApp via the connector SDK) handles its own
  // unlock + approval flow regardless of the normal status gate — and must not
  // be cluttered by the install banner.
  if (pathname === "/connect") return <BridgePopup />;

  return (
    <>
      <InstallPrompt />
      <GateContent status={status} />
    </>
  );
}

function GateContent({ status }: { status: ReturnType<typeof useSession>["status"] }) {
  if (status === "loading") {
    return (
      <div className="screen center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (status === "uninitialized") return <Onboarding />;
  if (status === "locked") return <LockedScreen />;

  // unlocked
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/send" element={<SendScreen />} />
      <Route path="/receive" element={<ReceiveScreen />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="/swap" element={<SwapScreen />} />
      <Route path="/swap/:id" element={<SwapScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
