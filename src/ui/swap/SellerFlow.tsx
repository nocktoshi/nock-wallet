import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import type { DraftSwap, SwapPublic } from "../../swap/swap.js";
import { generateSwapAction, withdrawUsdcAction } from "../../swap/actions/seller.js";
import { DEFAULT_NOCK_REFUND_DELTA, SOLVER_ASK_WINDOW_SEC } from "../../swap/config.js";
import { secretStore } from "../../swap/app/storage/secret-store.js";
import { getSwapRepository } from "../../swap/app/repo/swap-repo.js";
import { useSwapSession } from "./session.js";
import { SwapStepper } from "./SwapStepper.js";
import {
  belowMinNock,
  minNockAmountError,
  nicksToNock,
  nockToNicks,
  sellFragmentedBalanceError,
  sellInsufficientBalanceError,
} from "./util.js";
import { ErrorText, SwapWaiting } from "../components/primitives.js";
import { useNockSellQuote } from "./useNockSellQuote.js";
import { NICKS_PER_NOCK, formatNock } from "../../nock/units.js";
import { useBalance } from "../hooks.js";
import { checkSellAffordability } from "../../swap/nock/balance.js";

const SWAP_POLL_MS = 12_000;

type SellStage =
  | "input"
  | "waiting-claim"
  | "ready-to-lock"
  | "locking"
  | "confirming-lock"
  | "ready-to-withdraw"
  | "withdrawing"
  | "done";

const STEPPER = [
  { id: "order", label: "Place order" },
  { id: "lock", label: "Lock NOCK" },
  { id: "solver", label: "Solver pays" },
  { id: "withdraw", label: "Withdraw" },
  { id: "done", label: "Complete" },
];

function stepperIndex(stage: SellStage, swap: DraftSwap | null): number {
  if (stage === "done" || swap?.usdcWithdrawTxHash) return 4;
  if (stage === "ready-to-withdraw" || stage === "withdrawing" || swap?.usdcLockTxHash) return 3;
  if (swap?.lockFirstName || stage === "confirming-lock") return 2;
  if (stage === "ready-to-lock" || stage === "locking" || swap?.buyerPkh) return 1;
  return 0;
}

const patch = (setSwap: Dispatch<SetStateAction<DraftSwap>>, fields: Partial<SwapPublic>) =>
  setSwap((s) => ({ ...s, ...fields }));

export function SellerFlow({
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
  const { nock, evm, lockNockAction, fetchCurrentBlockHeight } = useSwapSession();
  const bal = useBalance(nock?.pkh);

  const [nockAmt, setNockAmt] = useState(() => (swap.nockGift ? nicksToNock(swap.nockGift) : ""));
  const { loading: quoting, quote, error: quoteError, online } = useNockSellQuote(nockAmt);
  const [stage, setStage] = useState<SellStage>(() => (swap.hEvm ? "waiting-claim" : "input"));
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [error, setError] = useState("");

  const swapPollInFlight = useRef(false);
  const actionInFlight = useRef(false);

  const logMsg = (msg: string) => setLog((l) => (l ? `${l}\n${msg}` : msg));
  const logErr = (err: unknown) =>
    setError(err instanceof Error ? err.message : String(err));

  const quoteReady = quote?.status === "ready";
  const estUsd = quoteReady && quote.amountOut ? parseFloat(quote.amountOut) : null;
  const maxNock = quoteReady && quote.maxAmountIn ? parseFloat(quote.maxAmountIn) : null;
  const amtNock = parseFloat(nockAmt);
  const overMax = maxNock != null && Number.isFinite(amtNock) && amtNock > maxNock;
  const underMin = belowMinNock(amtNock);
  const giftNicks = nockToNicks(nockAmt);
  const sellAffordability =
    nock?.pkh && giftNicks > 0n && !bal.loading
      ? checkSellAffordability(
          bal.notes.map((n) => ({ note: n.note, assets: n.assets })),
          giftNicks,
          nock.pkh
        )
      : null;
  const overBalance = sellAffordability?.insufficientTotal ?? false;
  const fragmented = sellAffordability?.fragmented ?? false;
  const largestNicks = bal.notes.reduce((m, n) => (n.assets > m ? n.assets : m), 0n);

  // Resume from /swap/:id
  useEffect(() => {
    if (!routeId || swap.hEvm === routeId) return;
    setStage("waiting-claim");
    void repo.get(routeId, { maxAgeMs: 5000 }).then((s) => {
      if (s) {
        setSwap(s);
        setNockAmt(nicksToNock(s.nockGift));
      }
    });
  }, [routeId, swap.hEvm, repo, setSwap]);

  // Poll GET /swap/:hEvm until solver claims and advances the swap.
  useEffect(() => {
    const hEvm = swap.hEvm;
    if (!hEvm || stage === "input" || stage === "done") return;
    let alive = true;

    const poll = async () => {
      if (swapPollInFlight.current || actionInFlight.current) return;
      swapPollInFlight.current = true;
      try {
        const s = await repo.get(hEvm, { maxAgeMs: 5000 });
        if (!alive || !s) return;
        setSwap(s);

        if (s.usdcWithdrawTxHash) {
          setStage("done");
          return;
        }
        if (s.usdcLockTxHash) {
          setStage((p) => (p === "withdrawing" ? p : "ready-to-withdraw"));
          return;
        }
        if (s.lockFirstName) {
          setStage((p) => (p === "locking" ? p : "confirming-lock"));
          return;
        }
        if (s.buyerPkh) {
          if (!nock || !evm) return;
          setStage((p) => (p === "locking" ? p : "ready-to-lock"));
          return;
        }
        setStage("waiting-claim");
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
  }, [swap.hEvm, stage, repo, setSwap, nock, evm]);

  useEffect(() => {
    if (quote?.status === "ready" && quote.amountOut) {
      patch(setSwap, { usdcAmount: quote.amountOut });
    }
  }, [quote, setSwap]);

  /** Post open ask to POST /swap — solver picks up via GET polling. */
  async function onPlaceOrder(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!nock) throw new Error("Unlock a signing account.");
      if (!evm) throw new Error("Connect your Ethereum wallet on Base.");
      if (!quoteReady || !quote?.amountOut) {
        throw new Error(quote?.reason ?? "No solver quote — enter NOCK and wait for a price.");
      }
      const amt = parseFloat(nockAmt);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a NOCK amount.");
      if (belowMinNock(amt)) throw new Error(minNockAmountError());
      if (maxNock != null && amt > maxNock) {
        throw new Error(`Solver can only pay for ~${maxNock.toFixed(2)} NOCK right now.`);
      }
      const gift = nockToNicks(nockAmt);
      const affordability = nock?.pkh
        ? checkSellAffordability(
            bal.notes.map((n) => ({ note: n.note, assets: n.assets })),
            gift,
            nock.pkh
          )
        : null;
      if (affordability?.insufficientTotal) {
        throw new Error(sellInsufficientBalanceError(gift, bal.total, affordability));
      }
      if (affordability?.fragmented) {
        const largest = bal.notes.reduce((m, n) => (n.assets > m ? n.assets : m), 0n);
        throw new Error(sellFragmentedBalanceError(gift, bal.total, largest, affordability));
      }

      const height = await fetchCurrentBlockHeight();
      if (height == null) throw new Error("Couldn't read Nockchain height — try again.");

      const usd = parseFloat(quote.amountOut);
      const nicks = BigInt(Math.floor(amt * Number(NICKS_PER_NOCK)));

      const { swap: created, preimageJam } = await generateSwapAction({
        buyerPkh: "",
        walletAddress: nock.pkh,
        sellerEth: evm,
        usdcAmount: usd.toFixed(6),
        gift: nicks.toString(),
        refundHeight: (height + DEFAULT_NOCK_REFUND_DELTA).toString(),
        usdcTimeoutSec: SOLVER_ASK_WINDOW_SEC,
      });

      await secretStore.putSellerPreimage(created.hEvm, preimageJam);
      await repo.create(created);

      setSwap(created);
      setStage("waiting-claim");
      navigate(`/swap/${created.hEvm}`);
      logMsg(`Order placed: ${amt} NOCK → ~$${usd.toFixed(2)} USDC. Waiting for solver…`);
    } catch (e) {
      logErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function onLockNock(): Promise<void> {
    if (busy || !swap.hEvm || !nock) return;
    setBusy(true);
    actionInFlight.current = true;
    setError("");
    try {
      setStage("locking");
      logMsg("Sign to lock your NOCK on Nockchain…");
      const { swap: locked } = await lockNockAction({
        swap: swap as SwapPublic,
        walletAddress: nock.pkh,
      });
      await repo.put(locked);
      setSwap(locked);
      setStage("confirming-lock");
      logMsg(`NOCK locked (tx ${locked.nockLockTxId ?? "…"}). Solver confirming and locking USDC…`);
    } catch (e) {
      setStage("ready-to-lock");
      logErr(e);
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function onWithdraw(): Promise<void> {
    if (busy || !swap.hEvm) return;
    setBusy(true);
    actionInFlight.current = true;
    setError("");
    try {
      setStage("withdrawing");
      logMsg("Approve USDC withdrawal in your Base wallet…");
      const { hash, swap: withdrawn } = await withdrawUsdcAction({ swap: swap as SwapPublic });
      await repo.put(withdrawn);
      setSwap(withdrawn);
      setStage("done");
      logMsg(`Withdrawn ${withdrawn.usdcAmount} USDC (tx ${hash}).`);
    } catch (e) {
      setStage("ready-to-withdraw");
      logErr(e);
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  const canAct = !!nock && !!evm;
  const activeStep = stepperIndex(stage, swap);

  // ── Active sell flow (order placed) ─────────────────────────────────────
  if (swap.hEvm || stage !== "input") {
    return (
      <div className="stack">
        <SwapStepper steps={STEPPER} currentIndex={activeStep} />

        <dl className="review swap-summary panel">
          <dt className="muted">You sell</dt>
          <dd>{nicksToNock(swap.nockGift)} NOCK</dd>
          <dt className="muted">You receive</dt>
          <dd>{swap.usdcAmount ? `$${swap.usdcAmount} USDC` : "…"}</dd>
          {swap.nockLockTxId && (
            <>
              <dt className="muted">NOCK lock tx</dt>
              <dd className="mono-wrap">{swap.nockLockTxId}</dd>
            </>
          )}
        </dl>

        {stage === "waiting-claim" && (
          <SwapWaiting label="Checking with solver" />
        )}
        {stage === "confirming-lock" && (
          <SwapWaiting label="NOCK locked — solver is confirming and paying USDC" />
        )}

        {stage === "locking" && <SwapWaiting label="Signing and locking NOCK" />}

        {stage === "ready-to-lock" && (
          <button
            type="button"
            className="primary big"
            disabled={busy || !canAct}
            onClick={() => void onLockNock()}
          >
            {`Lock ${nicksToNock(swap.nockGift)} NOCK`}
          </button>
        )}

        {stage === "withdrawing" && <SwapWaiting label="Withdrawing USDC" />}

        {stage === "ready-to-withdraw" && (
          <button
            type="button"
            className="primary big"
            disabled={busy || !canAct}
            onClick={() => void onWithdraw()}
          >
            {`Withdraw ${swap.usdcAmount} USDC`}
          </button>
        )}

        {stage === "done" && (
          <div className="stack swap-done">
            <div className="swap-done-icon">✓</div>
            <p>Swap complete — ${swap.usdcAmount} USDC received.</p>
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

  // ── Quote entry ───────────────────────────────────────────────────────────
  return (
    <div className="stack">
      <div className={"swap-interface" + (quoting ? " quoting" : "")}>
        <div className="swap-panel">
          <span className="swap-panel-label">You sell</span>
          <div className="swap-panel-row">
            <input
              className="swap-amount"
              type="number"
              min={50}
              placeholder="0"
              value={nockAmt}
              onChange={(e) => {
                setNockAmt(e.target.value);
                patch(setSwap, { nockGift: nockToNicks(e.target.value) });
              }}
            />
            <span className="swap-token-pill">NOCK</span>
          </div>
        </div>
        <div className="swap-connector" aria-hidden="true">⇅</div>
        <div className="swap-panel">
          <span className="swap-panel-label">You receive</span>
          <div className="swap-panel-row">
            {quoting ? (
              <div className="swap-amount-skeleton" aria-hidden="true" />
            ) : (
              <input
                className="swap-amount"
                readOnly
                placeholder="0"
                value={estUsd != null ? estUsd.toFixed(2) : ""}
              />
            )}
            <span className="swap-token-pill">USDC</span>
          </div>
        </div>
      </div>

      {quoting ? (
        <SwapWaiting label="Finding your best rate" />
      ) : online === false ? (
        <p className="swap-rate muted">Solver offline — try again shortly</p>
      ) : quoteReady && quote.pricePerNock != null ? (
        <p className="swap-rate muted">
          Rate ≈ ${quote.pricePerNock.toFixed(4)}/NOCK
          {maxNock != null && ` · max ${maxNock.toFixed(2)} NOCK`}
        </p>
      ) : quoteError ? (
        <p className="swap-rate swap-warn">{quoteError}</p>
      ) : null}
      {overMax && (
        <p className="swap-rate swap-warn">
          Solver can only quote ~{maxNock!.toFixed(2)} NOCK — try a smaller amount.
        </p>
      )}
      {underMin && nockAmt && <p className="swap-rate swap-warn">{minNockAmountError()}</p>}
      {overBalance && sellAffordability && (
        <p className="swap-rate swap-warn">
          {sellInsufficientBalanceError(giftNicks, bal.total, sellAffordability)}
        </p>
      )}
      {fragmented && sellAffordability && (
        <p className="swap-rate swap-warn">
          {sellFragmentedBalanceError(giftNicks, bal.total, largestNicks, sellAffordability)}
        </p>
      )}
      {nock && !bal.loading && (
        <p className="swap-rate muted">
          Available: {formatNock(bal.total, 2)} NOCK
          {sellAffordability && giftNicks > 0n
            ? ` · ~${formatNock(sellAffordability.feeNicks, 4)} lock fee`
            : ""}
        </p>
      )}

      <button
        type="button"
        className="primary big"
        disabled={
          busy ||
          quoting ||
          bal.loading ||
          !canAct ||
          !quoteReady ||
          !nockAmt ||
          overMax ||
          underMin ||
          overBalance ||
          fragmented
        }
        onClick={() => void onPlaceOrder()}
      >
        {busy ? "Placing order…" : estUsd ? `Sell → ~$${estUsd.toFixed(2)} USDC` : "Place order"}
      </button>

      {!canAct && (
        <p className="swap-hint">Connect Base wallet.</p>
      )}

      <ErrorText>{error}</ErrorText>
    </div>
  );
}