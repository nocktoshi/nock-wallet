import { useNavigate } from "react-router-dom";
import { useSession } from "../session.js";
import { Qr } from "../components/Qr.js";
import { CopyButton, Screen } from "../components/primitives.js";

export function ReceiveScreen() {
  const { active } = useSession();
  const navigate = useNavigate();
  if (!active) return null;

  return (
    <Screen
      title="Receive NOCK"
      subtitle={`To ${active.name}`}
      footer={<button onClick={() => navigate("/")}>← Back</button>}
    >
      <div className="receive">
        <Qr value={active.pkh} size={220} />
        <div className="address-box mono-wrap">{active.pkh}</div>
        <CopyButton text={active.pkh} label="Copy address" />
      </div>
    </Screen>
  );
}
