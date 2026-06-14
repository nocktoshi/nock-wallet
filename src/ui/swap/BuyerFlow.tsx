import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import type { Hex } from "viem";
import type { DraftSwap, SwapPublic } from "../../swap/swap.js";
import { lockUsdcAction, resolvePreimage } from "../../swap/actions/buyer.js";
import { verifyNockLockConfirmed } from "../../swap/nock/balance.js";
import { getSwapRepository } from "../../swap/app/repo/swap-repo.js";
import { useSwapSession } from "./session.js";
import { SwapStepper } from "./SwapStepper.js";
import { belowMinNock, minNockAmountError, nicksToNock } from "./util.js";
import { ErrorText, Spinner } from "../components/primitives.js";
import { useUsdcBuyQuote } from "./useUsdcBuyQuote.js";
import { NICKS_PER_NOCK } from "../../nock/units.js";

const SWAP_POLL_MS = 12_000;

type BuyStage =
  | "input"
  | "waiting-fill"
  | "verifying"
  | "ready-to-lock"
  | "locking"
  | "waiting-reveal"
  | "ready-to-claim"
  | "claiming"
  | "done";

const STEPPER = [
  { id: "order", label: "Place order" },
  { id: "solver", label: "Solver locks NOCK" },
  { id: "lock", label: "Lock USDC" },
  { id: "finalize", label: "Finalize" },
  { id: "done", label: "Complete" },
];

function stepperIndex(stage: BuyStage, swap: DraftSwap | null): number {
  if (stage === "done" || swap?.nockClaimTxId) return 4;
  if (stage === "ready-to-claim" || stage === "claiming" || swap?.usdcWithdrawTxHash) return 3;
  if (swap?.usdcLockTxHash || stage === "waiting-reveal") return 2;
  if (stage === "ready-to-lock" || stage === "locking") return 2;
  if (swap?.lockFirstName || stage === "verifying") return 1;
  return 0;
}

const patch = (setSwap: Dispatch<SetStateAction<DraftSwap>>, fields: Partial<SwapPublic>) =>
  setSwap((s) => ({ ...s, ...fields }));

export function BuyerFlow({
  swap,
  setSwap,
  routeId,
}: {
  swap: DraftSwap;
  setSwap: Dispatch<SetStateAction<DraftSwap>>;
  routeId?: string;
}) {
  const navigate = useNavigate();
  const repo = useMemo(() => getSwapRepository(), []);
  const { nock, evm, claimNockAction } = useSwapSession();

  const [usdAmt, setUsdAmt] = useState(() => swap.usdcAmount === '0' ? "" : swap.usdcAmount ?? "");
  const { loading: quoting, quote, error: quoteError, online } = useUsdcBuyQuote(usdAmt);
  const [bidId, setBidId] = useState<string | undefined>();
  const [stage, setStage] = useState<BuyStage>(() =>
    swap.hEvm || routeId ? "waiting-fill" : "input"
  );
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [error, setError] = useState("");

  const swapPollInFlight = useRef(false);
  const actionInFlight = useRef(false);
  const evmSwapIdRef = useRef<Hex | null>(null);

  const logMsg = (msg: string) => setLog((l) => (l ? `${l}\n${msg}` : msg));
  const logErr = (err: unknown) =>
    setError(err instanceof Error ? err.message : String(err));

  const quoteReady = quote?.status === "ready";
  const estNock = quoteReady && quote.amountOut ? parseFloat(quote.amountOut) : null;
  const maxUsd = quoteReady && quote.maxAmountIn ? parseFloat(quote.maxAmountIn) : null;
  const amtUsd = parseFloat(usdAmt);
  const overMax = maxUsd != null && Number.isFinite(amtUsd) && amtUsd > maxUsd;
  const underMin = estNock != null && belowMinNock(estNock);

  // Resume from /swap/:id (bid id or swap hEvm)
  useEffect(() => {
    if (!routeId) return;
    if (swap.hEvm === routeId) {
      setBidId(undefined);
      return;
    }
    void (async () => {
      if (swap.hEvm) return;
      const found = await repo.get(routeId, { maxAgeMs: 5000 });
      if (found) {
        setSwap(found);
        setUsdAmt(found.usdcAmount ?? "");
        return;
      }
      const bid = await repo.getBid(routeId);
      if (bid?.filledHEvm) {
        const filled = await repo.get(bid.filledHEvm, { maxAgeMs: 5000 });
        if (filled) {
          setSwap(filled);
          setUsdAmt(filled.usdcAmount ?? "");
        }
        return;
      }
      if (bid?.bid) {
        setBidId(bid.bid.id);
        setUsdAmt(bid.bid.quoteAmount);
        patch(setSwap, {
          usdcAmount: bid.bid.quoteAmount,
          nockGift: bid.bid.nockGift,
        });
        setStage("waiting-fill");
      }
    })();
  }, [routeId, swap.hEvm, repo, setSwap]);

  // Poll bid fill + swap progress
  useEffect(() => {
    const hEvm = swap.hEvm;
    const activeBid = bidId;
    if ((!hEvm && !activeBid) || stage === "input" || stage === "done") return;
    let alive = true;

    const poll = async () => {
      if (swapPollInFlight.current || actionInFlight.current) return;
      swapPollInFlight.current = true;
      try {
        let id: string | undefined = hEvm;
        if (!id && activeBid) {
          const found = await repo.getBid(activeBid);
          if (!alive) return;
          if (found?.filledHEvm) {
            id = found.filledHEvm;
            const s = await repo.get(found.filledHEvm, { maxAgeMs: 5000 });
            if (!alive || !s) return;
            setSwap(s);
          } else {
            setStage("waiting-fill");
            return;
          }
        }
        if (!id) return;

        const s = await repo.get(id, { maxAgeMs: 5000 });
        if (!alive || !s) return;
        setSwap(s);

        if (s.nockClaimTxId) {
          setStage("done");
          return;
        }
        if (s.usdcWithdrawTxHash) {
          setStage((p) => (p === "claiming" ? p : "ready-to-claim"));
          return;
        }
        if (s.usdcLockTxHash) {
          setStage("waiting-reveal");
          return;
        }
        if (s.lockFirstName) {
          if (!nock || !evm) {
            setStage("verifying");
            return;
          }
          const v = await verifyNockLockConfirmed(nock, {
            lockFirstName: s.lockFirstName,
            lockRoot: s.lockRoot,
            parentHash: s.parentHash,
            hNock: s.hNock,
            buyerPkh: nock.pkh,
            sellerPkh: s.sellerPkh,
            refundHeight: s.nockRefundHeight,
            gift: s.nockGift,
            usdcTimelock: s.usdcTimelock,
            nockRefundHeight: s.nockRefundHeight,
          });
          if (!alive) return;
          if (v.ok) setStage((p) => (p === "locking" ? p : "ready-to-lock"));
          else if (v.fatal) {
            logErr(v.reason ?? "NOCK lock verification failed");
          } else setStage("verifying");
          return;
        }
        setStage("waiting-fill");
      } catch {
        /* transient — next poll */
      } finally {
        swapPollInFlight.current = false;
      }
    };

    void poll();
    const t = window.setInterval(() => void poll(), SWAP_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [swap.hEvm, bidId, stage, repo, setSwap, nock, evm]);

  useEffect(() => {
    if (quote?.status === "ready" && quote.amountOut) {
      const nicks = BigInt(Math.floor(parseFloat(quote.amountOut) * Number(NICKS_PER_NOCK)));
      patch(setSwap, { nockGift: nicks });
    }
  }, [quote, setSwap]);

  async function onPlaceOrder(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!nock) throw new Error("Unlock a signing account.");
      if (!evm) throw new Error("Connect your Ethereum wallet on Base.");
      if (!quoteReady || !quote?.amountOut) {
        throw new Error(quote?.reason ?? "No solver quote — enter USDC and wait for a price.");
      }
      const amt = parseFloat(usdAmt);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a USDC amount.");
      if (maxUsd != null && amt > maxUsd) {
        throw new Error(`Solver can only cover ~$${maxUsd.toFixed(2)} right now.`);
      }

      const nockAmt = parseFloat(quote.amountOut);
      if (belowMinNock(nockAmt)) throw new Error(minNockAmountError());
      const nicks = BigInt(Math.floor(nockAmt * Number(NICKS_PER_NOCK)));

      const bid = await repo.createBid({
        token: "USDC",
        quoteAmount: amt.toFixed(6),
        nockGift: nicks,
        creatorEth: evm,
      });

      setBidId(bid.id);
      patch(setSwap, { usdcAmount: amt.toFixed(6), nockGift: nicks });
      setStage("waiting-fill");
      navigate(`/swap/${bid.id}`);
      logMsg(`Order placed: $${amt.toFixed(2)} USDC → ~${nockAmt.toFixed(2)} NOCK. Waiting for solver…`);
    } catch (e) {
      logErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function onLockUsdc(): Promise<void> {
    if (busy || !swap.hEvm || !nock) return;
    setBusy(true);
    actionInFlight.current = true;
    setError("");
    try {
      setStage("locking");
      logMsg("Approve + lock USDC in your Base wallet…");
      const { swapId, lockTxHash, swap: locked } = await lockUsdcAction({ swap: swap as SwapPublic });
      evmSwapIdRef.current = swapId;
      await repo.put(locked);
      setSwap(locked);
      setStage("waiting-reveal");
      logMsg(`USDC locked (tx ${lockTxHash}). Solver finalizing…`);
    } catch (e) {
      setStage("ready-to-lock");
      logErr(e);
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function onClaimNock(): Promise<void> {
    if (busy || !swap.hEvm || !nock) return;
    setBusy(true);
    actionInFlight.current = true;
    setError("");
    try {
      setStage("claiming");
      logMsg("Sign to claim your NOCK…");
      const { preimageJam } = await resolvePreimage({
        swap: swap as SwapPublic,
        cached: null,
        withdrawTx: (swap.usdcWithdrawTxHash ?? "") as Hex,
        swapId: evmSwapIdRef.current,
      });
      const { txId, swap: claimed } = await claimNockAction({
        swap: swap as SwapPublic,
        preimageJam,
        lockFirstName: swap.lockFirstName ?? "",
        gift: swap.nockGift!.toString(),
      });
      await repo.put(claimed);
      setSwap(claimed);
      setStage("done");
      logMsg(`NOCK claimed (tx ${txId}).`);
    } catch (e) {
      setStage("ready-to-claim");
      logErr(e);
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  const canAct = !!nock && !!evm;
  const activeStep = stepperIndex(stage, swap);
  const inFlow = !!(swap.hEvm || bidId || stage !== "input");

  if (inFlow) {
    return (
      <div className="stack">
        <SwapStepper steps={STEPPER} currentIndex={activeStep} />

        <dl className="review swap-summary panel">
          <dt className="muted">You pay</dt>
          <dd>{swap.usdcAmount ? `$${swap.usdcAmount} USDC` : "…"}</dd>
          <dt className="muted">You receive</dt>
          <dd>{swap.nockGift ? `${nicksToNock(swap.nockGift)} NOCK` : "…"}</dd>
          {swap.nockLockTxId && (
            <>
              <dt className="muted">NOCK lock tx</dt>
              <dd className="mono-wrap">{swap.nockLockTxId}</dd>
            </>
          )}
          {swap.nockClaimTxId && (
            <>
              <dt className="muted">NOCK claim tx</dt>
              <dd className="mono-wrap">{swap.nockClaimTxId}</dd>
            </>
          )}
        </dl>

        {stage === "waiting-fill" && (
          <div className="swap-hint row gap">
            <Spinner label="Checking with solver…" />
          </div>
        )}
        {stage === "verifying" && (
          <p className="swap-hint">
            Solver locked NOCK on-chain. Verifying the lock before you pay USDC…
          </p>
        )}
        {stage === "waiting-reveal" && (
          <p className="swap-hint">
            USDC locked. Solver is finalizing and releasing the preimage (~1 min).
          </p>
        )}

        {stage === "ready-to-lock" && (
          <button
            type="button"
            className="primary big"
            disabled={busy || !canAct}
            onClick={() => void onLockUsdc()}
          >
            {busy ? "Opening wallet…" : `Lock ${swap.usdcAmount} USDC`}
          </button>
        )}

        {stage === "ready-to-claim" && (
          <button
            type="button"
            className="primary big"
            disabled={busy || !canAct}
            onClick={() => void onClaimNock()}
          >
            {busy ? "Signing…" : `Claim ${nicksToNock(swap.nockGift)} NOCK`}
          </button>
        )}

        {stage === "done" && (
          <div className="stack swap-done">
            <div className="swap-done-icon">✓</div>
            <p>Swap complete — you received {nicksToNock(swap.nockGift)} NOCK.</p>
          </div>
        )}

        {!canAct && stage !== "done" && (
          <p className="swap-hint">Connect Base wallet.</p>
        )}

        {log && <pre className="swap-log panel muted">{log}</pre>}
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className={"swap-interface" + (quoting ? " quoting" : "")}>
        <div className="swap-panel">
          <span className="swap-panel-label">You pay</span>
          <div className="swap-panel-row">
            <input
              className="swap-amount"
              type="number"
              min="0"
              placeholder="0"
              value={usdAmt}
              onChange={(e) => {
                setUsdAmt(e.target.value);
                patch(setSwap, { usdcAmount: e.target.value.trim() || undefined });
              }}
            />
            <span className="swap-token-pill">USDC</span>
          </div>
        </div>
        <div className="swap-connector" aria-hidden="true">⇅</div>
        <div className="swap-panel">
          <span className="swap-panel-label">You receive</span>
          <div className="swap-panel-row">
            <input
              className="swap-amount"
              readOnly
              placeholder={quoting ? "…" : "0"}
              value={quoting ? "" : estNock != null ? estNock.toFixed(2) : ""}
            />
            <span className="swap-token-pill">NOCK</span>
          </div>
        </div>
      </div>

      {quoting ? (
        <p className="swap-rate quoting muted">Getting quote…</p>
      ) : online === false ? (
        <p className="swap-rate muted">Solver offline — try again shortly</p>
      ) : quoteReady && quote.pricePerNock != null ? (
        <p className="swap-rate muted">
          Rate ≈ ${quote.pricePerNock.toFixed(4)}/NOCK
          {maxUsd != null && ` · max $${maxUsd.toFixed(2)} per swap`}
        </p>
      ) : quoteError ? (
        <p className="swap-rate swap-warn">{quoteError}</p>
      ) : null}
      {overMax && (
        <p className="swap-rate swap-warn">
          Solver can only cover ~${maxUsd!.toFixed(2)} right now — try a smaller amount.
        </p>
      )}
      {underMin && usdAmt && <p className="swap-rate swap-warn">{minNockAmountError()}</p>}

      <button
        type="button"
        className="primary big"
        disabled={
          busy ||
          quoting ||
          !canAct ||
          !quoteReady ||
          !usdAmt ||
          overMax ||
          underMin
        }
        onClick={() => void onPlaceOrder()}
      >
        {busy ? "Placing order…" : estNock ? `Buy → ~${estNock.toFixed(2)} NOCK` : "Place order"}
      </button>

      {!canAct && (
        <p className="swap-hint">Connect Base wallet.</p>
      )}

      <ErrorText>{error}</ErrorText>
    </div>
  );
}