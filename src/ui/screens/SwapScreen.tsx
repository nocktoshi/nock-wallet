import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSession } from "../session.js";
import { SwapSessionProvider } from "../swap/session.js";
import { EvmWalletConnect } from "../swap/EvmWalletConnect.js";
import { SellerFlow } from "../swap/SellerFlow.js";
import { BuyerFlow } from "../swap/BuyerFlow.js";
import { getSwapRepository } from "../../swap/app/repo/swap-repo.js";
import { roleForSwap } from "../../swap/app/roles.js";
import type { DraftSwap } from "../../swap/swap.js";
import { Screen, Spinner } from "../components/primitives.js";
import { useSwapSession } from "../swap/session.js";

type Direction = "sell" | "buy";

function SwapScreenInner() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { active } = useSession();
  const { nock, evm } = useSwapSession();

  const [direction, setDirection] = useState<Direction>("buy");
  const [swap, setSwap] = useState<DraftSwap>({});
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setLoadError("");
    void (async () => {
      try {
        const repo = getSwapRepository();
        const s = await repo.get(id);
        if (s) {
          setSwap(s);
          const role = roleForSwap(s, {
            nock: nock ? { pkh: nock.pkh, address: nock.address } : null,
            eth: evm,
          });
          setDirection(role === "seller" ? "sell" : "buy");
          return;
        }
        const bid = await repo.getBid(id);
        if (bid) {
          setDirection("buy");
          if (bid.filledHEvm) {
            const filled = await repo.get(bid.filledHEvm);
            if (filled) setSwap(filled);
          }
          return;
        }
        setLoadError("Swap not found.");
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, nock, evm]);

  if (!active) return null;

  if (!active.canSign) {
    return (
      <Screen
        title="Watch-only account"
        subtitle="Swap requires a signing account."
        footer={<button onClick={() => navigate("/")}>← Back</button>}
      >
        <p className="muted">Switch to an account you can sign with, or import your recovery phrase.</p>
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen title="Swap" footer={<button onClick={() => navigate("/")}>← Back</button>}>
        <Spinner label="Loading swap…" />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen title="Swap" footer={<button onClick={() => navigate("/swap")}>← Back</button>}>
        <p className="error-text">{loadError}</p>
      </Screen>
    );
  }

  const showDirectionPicker = !id && !swap.hEvm;

  return (
    <Screen
      title="Swap"
      subtitle="Atomic cross-chain swap between NOCK and USDC on Base"
      footer={<button onClick={() => navigate("/")}>← Back</button>}
    >
      <EvmWalletConnect />

      {showDirectionPicker && (
        <div className="swap-direction">
          <button
            type="button"
            className={"swap-dir-btn" + (direction === "buy" ? " active" : "")}
            onClick={() => setDirection("buy")}
          >
            <span className="swap-dir-label">Buy ℕOCK</span>
            <span className="muted">Pay USDC</span>
          </button>
          <button
            type="button"
            className={"swap-dir-btn" + (direction === "sell" ? " active" : "")}
            onClick={() => setDirection("sell")}
          >
            <span className="swap-dir-label">Sell ℕOCK</span>
            <span className="muted">Receive USDC</span>
          </button>
        </div>
      )}

      {direction === "sell" && (
        <SellerFlow swap={swap} setSwap={setSwap} routeId={id} />
      )}
      {direction === "buy" && (
        <BuyerFlow swap={swap} setSwap={setSwap} routeId={id} />
      )}
    </Screen>
  );
}

export function SwapScreen() {
  return (
    <SwapSessionProvider>
      <SwapScreenInner />
    </SwapSessionProvider>
  );
}