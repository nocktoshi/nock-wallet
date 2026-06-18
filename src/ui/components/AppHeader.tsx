import { useNavigate } from "react-router-dom";
import { useSession } from "../session.js";
import { GearIcon, LockIcon } from "./icons.js";
import logo from "../../../public/app-icon.png";

/** Persistent brand bar shown across every unlocked flow (home, send, receive,
 *  swap, settings). The logo returns home; the gear opens settings; the lock
 *  locks the wallet. */
export function AppHeader() {
  const navigate = useNavigate();
  const { lock } = useSession();
  return (
    <header className="app-header">
      <button
        type="button"
        className="app-brand"
        title="Home"
        aria-label="Home"
        onClick={() => navigate("/")}
      >
        <img className="app-logo" src={logo} alt="" />
        <span className="app-title">ℕock 𝕎allet</span>
      </button>
      <div className="app-header-actions">
        <button
          type="button"
          className="icon-btn"
          title="Settings"
          aria-label="Settings"
          onClick={() => navigate("/settings")}
        >
          <GearIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Lock wallet"
          aria-label="Lock wallet"
          onClick={lock}
        >
          <LockIcon />
        </button>
      </div>
    </header>
  );
}
