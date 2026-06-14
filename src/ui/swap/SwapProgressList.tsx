import { useNavigate } from "react-router-dom";
import type { SwapPublic } from "../../swap/swap.js";
import { roleForSwap, swapStatus, type SwapStage } from "../../swap/app/roles.js";
import type { Digest } from "@nockchain/rose-ts";
import { formatNock } from "../../nock/units.js";
import { shortMiddle } from "../format.js";
import type { SwapsInProgressState } from "./useSwapsInProgress.js";

function stageLabel(status: SwapStage, hasBuyer: boolean): string {
  const labels: Record<SwapStage, string> = {
    created: hasBuyer ? "Ready to lock" : "Waiting for buyer",
    "nock-locked": "NOCK locked",
    "usdc-locked": "USDC locked",
    withdrawn: "Complete",
    claimed: "Complete",
    refunded: "Refunded",
  };
  return labels[status];
}

function quoteLabel(swap: SwapPublic, role: string): string {
  const nock = formatNock(swap.nockGift, 4);
  const usdc = swap.usdcAmount?.trim();
  return usdc && role === 'seller' ? `${nock}ℕ → $${usdc}` : nock + 'ℕ';
}

export function SwapProgressList({
  pkh,
  state,
}: {
  pkh: Digest;
  state: SwapsInProgressState;
}) {
  const navigate = useNavigate();
  const { swaps, loading, error, refresh } = state;

  if (!loading && swaps.length === 0 && !error) return null;

  return (
    <div className="tx-list swap-progress-list">
      <div className="field-label row spread">
        <span>Swaps</span>
        <button type="button" className="link-btn" onClick={refresh}>
          refresh
        </button>
      </div>

      {loading && swaps.length === 0 ? (
        <p className="hint muted">Loading swaps…</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : (
        swaps.map((swap) => {
          const role = roleForSwap(swap, { nock: { pkh } }) ?? "seller";
          const status = swapStatus(swap);
          const hasBuyer = !!swap.buyerPkh?.trim();
          return (
            <button
              key={swap.hEvm}
              type="button"
              className="tx-row swap-progress-row"
              onClick={() => navigate(`/swap/${swap.hEvm}`)}
            >
              <div className="tx-row-main">
                <span className="tx-dir">{role === "seller" ? "Sell ℕOCK" : "Buy ℕOCK"}</span>
                <span className="tx-amt">{quoteLabel(swap, role)}</span>
              </div>
              <div className="tx-row-meta muted">
                <span>{shortMiddle(swap.hEvm, 8, 6)}</span>
                <span className="swap-progress-status">{stageLabel(status, hasBuyer)}</span>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}