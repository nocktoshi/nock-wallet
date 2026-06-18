import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import type { Hex, Address } from "viem";
import type { DraftSwap, SwapPublic } from "../../swap/swap.js";
import {
  lockUsdcAction,
  resolvePreimage,
  refundUsdcAction,
  usdcNeedsApprovalAction,
  approveUsdcAction,
} from "../../swap/actions/buyer.js";
import { computeSwapId, getOnchainLock, usdcToAtomic } from "../../swap/evm/htlc.js";
import { verifyNockLockConfirmed } from "../../swap/nock/balance.js";
import { getSwapRepository } from "../../swap/app/repo/swap-repo.js";
import { useSwapSession } from "./session.js";
import { SwapStepper } from "./SwapStepper.js";
import { belowMinNock, minNockAmountError, nicksToNock } from "./util.js";
import { ErrorText, Spinner } from "../components/primitives.js";
import { useUsdcBuyQuote } from "./useUsdcBuyQuote.js";
import { NICKS_PER_NOCK } from "../../nock/units.js";

const SWAP_POLL_MS = 12_000;

// The on-chain USDC lock and the worker "advance" that records it are two steps.
// If the lock lands but the publish fails (expired session, network, closed tab),
// the swap is orphaned: funds locked, solver none the wiser. We durably stash the
// lock locally the instant it confirms, retry the publish, and re-publish on the
// next visit — so a transient failure self-heals instead of stranding the buyer.
const PENDING_LOCK_PREFIX = "rose:pending-usdc-lock:";

function savePendingLock(hEvm: string, fields: { usdcLockTxHash: string; buyerEth: string }): void {
  try {
    localStorage.setItem(PENDING_LOCK_PREFIX + hEvm.toLowerCase(), JSON.stringify(fields));
  } catch {
    /* storage unavailable (private mode etc.) — chain recovery still covers it */
  }
}

function loadPendingLock(hEvm: string): { usdcLockTxHash: string; buyerEth: string } | null {
  try {
    const raw = localStorage.getItem(PENDING_LOCK_PREFIX + hEvm.toLowerCase());
    return raw ? (JSON.parse(raw) as { usdcLockTxHash: string; buyerEth: string }) : null;
  } catch {
    return null;
  }
}

function clearPendingLock(hEvm: string): void {
  try {
    localStorage.removeItem(PENDING_LOCK_PREFIX + hEvm.toLowerCase());
  } catch {
    /* ignore */
  }
}

async function publishWithRetry(
  put: (s: SwapPublic) => Promise<void>,
  swap: SwapPublic,
  attempts = 4
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await put(swap);
      return;
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "publish failed"));
}

type BuyStage =
  | "input"
  | "waiting-fill"
  | "verifying"
  | "ready-to-lock"
  | "locking"
  | "waiting-reveal"
  | "ready-to-claim"
  | "claiming"
  | "refunding"
  | "refunded"
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
  if (stage === "refunded" || swap?.usdcRefundTxHash) return 2;
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
  // null = not yet checked; true = ERC20 approval still needed before locking.
  const [needsApproval, setNeedsApproval] = useState<boolean | null>(null);

  const swapPollInFlight = useRef(false);
  const actionInFlight = useRef(false);
  const evmSwapIdRef = useRef<Hex | null>(null);
  const lockDetectedRef = useRef<Set<string>>(new Set());

  const logMsg = (msg: string) => setLog((l) => (l ? `${l}\n${msg}` : msg));
  const logErr = (err: unknown) =>
    setError(err instanceof Error ? err.message : String(err));

  // Detect a USDC lock the buyer already placed on-chain (a prior publish failed,
  // or they returned later/on another device) and make sure the worker reflects
  // it. Returns true when a live lock exists — so we show "finalizing" instead of
  // prompting another lock (which the contract would reject as a duplicate).
  const detectAndSyncLock = useCallback(
    async (s: SwapPublic): Promise<boolean> => {
      if (!evm || !s.sellerEth || !s.usdcAmount || s.usdcTimelock == null) return false;
      const buyer = (s.buyerEth ?? evm) as Address;
      const amount = await usdcToAtomic(s.usdcAmount, s.token);
      const swapId = await computeSwapId(
        { seller: s.sellerEth as Address, buyer, amount, hashlock: s.hEvm as Hex, timelock: s.usdcTimelock },
        s.token
      );
      const lock = await getOnchainLock(swapId, s.token);
      if (!lock || lock.amount <= 0n || lock.refunded || lock.withdrawn) return false;
      evmSwapIdRef.current = swapId;
      // Push the lock tx to the worker if we still know it (from this device's
      // pending stash); otherwise the solver recovers it from chain on its side.
      const usdcLockTxHash = loadPendingLock(s.hEvm)?.usdcLockTxHash ?? s.usdcLockTxHash;
      if (usdcLockTxHash) {
        try {
          await publishWithRetry((x) => repo.put(x), { ...s, buyerEth: lock.buyer, usdcLockTxHash });
          clearPendingLock(s.hEvm);
        } catch {
          /* worker still unaware — kept pending; solver also recovers from chain */
        }
      }
      return true;
    },
    [evm, repo]
  );

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
    if ((!hEvm && !activeBid) || stage === "input" || stage === "done" || stage === "refunded") return;
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
        if (s.usdcRefundTxHash) {
          setStage("refunded");
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
          // Already locked on a prior poll this session — don't re-prompt.
          if (lockDetectedRef.current.has(id)) {
            setStage((p) => (p === "locking" ? p : "waiting-reveal"));
            return;
          }
          if (!nock || !evm) {
            setStage("verifying");
            return;
          }
          // The buyer may have already locked USDC on-chain (a prior publish
          // failed). Detect + re-sync before prompting another lock.
          try {
            if (await detectAndSyncLock(s)) {
              lockDetectedRef.current.add(id);
              if (!alive) return;
              setStage("waiting-reveal");
              return;
            }
          } catch {
            /* transient chain read — retry on the next poll */
          }
          if (!alive) return;
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
  }, [swap.hEvm, bidId, stage, repo, setSwap, nock, evm, detectAndSyncLock]);

  useEffect(() => {
    if (quote?.status === "ready" && quote.amountOut) {
      const nicks = BigInt(Math.floor(parseFloat(quote.amountOut) * Number(NICKS_PER_NOCK)));
      patch(setSwap, { nockGift: nicks });
    }
  }, [quote, setSwap]);

  // Re-evaluate approval whenever the swap changes.
  useEffect(() => {
    setNeedsApproval(null);
  }, [swap.hEvm]);

  // Once ready to lock, check on-chain whether the buyer still needs to approve
  // the HTLC — the lock is then explicitly two steps (approve, then lock).
  useEffect(() => {
    if (stage !== "ready-to-lock" || needsApproval !== null) return;
    if (!evm || !swap.sellerEth || !swap.usdcAmount) return;
    let alive = true;
    void (async () => {
      try {
        const need = await usdcNeedsApprovalAction({ swap: swap as SwapPublic });
        if (alive) setNeedsApproval(need);
      } catch {
        // Default to showing Approve if we can't read the allowance — approving
        // when already approved just re-sets it; locking unapproved would revert.
        if (alive) setNeedsApproval(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [stage, needsApproval, evm, swap]);

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

  async function onApproveUsdc(): Promise<void> {
    if (busy || !swap.hEvm) return;
    if (!evm) {
      setError("Connect your Base wallet to approve.");
      return;
    }
    setBusy(true);
    actionInFlight.current = true;
    setError("");
    try {
      logMsg("Approve USDC spending in your Base wallet…");
      const { hash } = await approveUsdcAction({ swap: swap as SwapPublic });
      logMsg(`USDC approved (tx ${hash}). Now lock to continue.`);
      setNeedsApproval(false);
    } catch (e) {
      logErr(e);
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function onLockUsdc(): Promise<void> {
    if (busy || !swap.hEvm || !nock) return;
    const hEvm = swap.hEvm;
    setBusy(true);
    actionInFlight.current = true;
    setError("");
    try {
      setStage("locking");
      // If a prior attempt already locked on-chain, re-sync instead of locking
      // again (a duplicate lock reverts). Covers a publish that failed last time.
      if (await detectAndSyncLock(swap as SwapPublic)) {
        lockDetectedRef.current.add(hEvm);
        setStage("waiting-reveal");
        logMsg("USDC already locked on-chain — solver finalizing…");
        return;
      }
      logMsg("Approve + lock USDC in your Base wallet…");
      const { swapId, lockTxHash, swap: locked } = await lockUsdcAction({ swap: swap as SwapPublic });
      evmSwapIdRef.current = swapId;
      // Durably record the lock locally the instant it confirms — BEFORE the
      // worker write — so a failed/interrupted publish can be retried later
      // (the on-chain funds are already committed at this point).
      savePendingLock(locked.hEvm, {
        usdcLockTxHash: locked.usdcLockTxHash as string,
        buyerEth: locked.buyerEth as string,
      });
      lockDetectedRef.current.add(locked.hEvm);
      setSwap(locked);
      setStage("waiting-reveal");
      logMsg(`USDC locked (tx ${lockTxHash}). Notifying solver…`);
      try {
        await publishWithRetry((x) => repo.put(x), locked);
        clearPendingLock(locked.hEvm);
        logMsg("Solver notified — finalizing…");
      } catch {
        // Lock is safe on-chain; the worker write didn't land. We keep the
        // pending stash and re-publish on the next poll/visit, and the solver
        // independently recovers the lock from chain. Don't fail back to
        // "ready-to-lock" — re-locking would revert.
        logMsg("Your USDC is locked, but the solver couldn't be reached yet — we'll keep retrying automatically. You can also refund below once the timelock passes.");
      }
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

  // Reclaim USDC the buyer locked on-chain when the swap stalled — including the
  // case where the lock never registered with the worker (publish failed after
  // the on-chain lock), so the worker record has no usdcLockTxHash/buyerEth. We
  // recompute the swap id from the connected wallet and refund straight on-chain.
  async function onRefundUsdc(): Promise<void> {
    if (busy || stage === "refunding") return;
    if (!evm) {
      setError("Connect your Base wallet to refund.");
      return;
    }
    if (!swap.hEvm || !swap.sellerEth || !swap.usdcAmount || swap.usdcTimelock == null) {
      setError("This swap is missing the details needed to refund.");
      return;
    }
    setBusy(true);
    actionInFlight.current = true;
    setError("");
    const prevStage = stage;
    try {
      setStage("refunding");
      logMsg("Checking your on-chain USDC lock…");
      const buyer = (swap.buyerEth ?? evm) as Address;
      const amount = await usdcToAtomic(swap.usdcAmount, swap.token);
      const swapId = await computeSwapId(
        {
          seller: swap.sellerEth as Address,
          buyer,
          amount,
          hashlock: swap.hEvm as Hex,
          timelock: swap.usdcTimelock,
        },
        swap.token
      );
      const lock = await getOnchainLock(swapId, swap.token);
      if (!lock || lock.amount <= 0n || lock.refunded) {
        throw new Error("No refundable USDC lock found for this swap — it may already be refunded.");
      }
      if (lock.withdrawn) {
        throw new Error("The seller already finalized this swap — claim your NOCK instead of refunding.");
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const unlock = Number(swap.usdcTimelock);
      if (nowSec < unlock) {
        throw new Error(
          `USDC is still time-locked. You can refund after ${new Date(unlock * 1000).toLocaleString()}.`
        );
      }
      logMsg("Approve the refund in your Base wallet…");
      const { hash, swap: refunded } = await refundUsdcAction({
        swap: { ...(swap as SwapPublic), buyerEth: buyer },
      });
      setSwap(refunded);
      setStage("refunded");
      logMsg(`USDC refunded (tx ${hash}). Funds are back in your wallet.`);
      // Best-effort: tell the worker so the solver stops waiting. The on-chain
      // refund already succeeded regardless of whether this write lands.
      try {
        await repo.put(refunded);
      } catch {
        /* ignore — record update is non-critical */
      }
    } catch (e) {
      setStage(prevStage);
      logErr(e);
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  const canAct = !!nock && !!evm;
  const activeStep = stepperIndex(stage, swap);
  // A locked-but-unfinished swap can be reclaimed. Hidden once it's claimed,
  // already refunded, or the seller withdrew (the buyer should claim instead),
  // and before the solver has even locked NOCK (no lock can exist yet).
  const canRefund =
    !!swap.hEvm &&
    !!swap.sellerEth &&
    !!swap.usdcAmount &&
    swap.usdcTimelock != null &&
    !swap.nockClaimTxId &&
    !swap.usdcRefundTxHash &&
    !swap.usdcWithdrawTxHash &&
    stage !== "input" &&
    stage !== "waiting-fill" &&
    stage !== "refunded";
  const refundReadyAt =
    swap.usdcTimelock != null ? new Date(Number(swap.usdcTimelock) * 1000).toLocaleString() : "";
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

        {stage === "locking" && (
          <div className="swap-hint row gap">
            <Spinner label="Locking USDC…" />
          </div>
        )}

        {stage === "ready-to-lock" && needsApproval === null && canAct && (
          <div className="swap-hint row gap">
            <Spinner label="Checking USDC approval…" />
          </div>
        )}

        {stage === "ready-to-lock" && needsApproval === true && (
          <div className="stack">
            <p className="swap-hint muted">Step 1 of 2 — approve USDC, then lock it.</p>
            <button
              type="button"
              className="primary big"
              disabled={busy || !canAct}
              onClick={() => void onApproveUsdc()}
            >
              {busy ? "Approving…" : `Approve ${swap.usdcAmount} USDC`}
            </button>
          </div>
        )}

        {stage === "ready-to-lock" && needsApproval === false && (
          <button
            type="button"
            className="primary big"
            disabled={busy || !canAct}
            onClick={() => void onLockUsdc()}
          >
            {busy ? "Locking…" : `Lock ${swap.usdcAmount} USDC`}
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

        {(stage === "refunded" || swap.usdcRefundTxHash) && (
          <div className="stack swap-done">
            <div className="swap-done-icon">↩</div>
            <p>USDC refunded — your funds are back in your wallet.</p>
            {swap.usdcRefundTxHash && <span className="mono-wrap">{swap.usdcRefundTxHash}</span>}
          </div>
        )}

        {!canAct && stage !== "done" && stage !== "refunded" && (
          <p className="swap-hint">Connect Base wallet.</p>
        )}

        {canRefund && (
          <div className="stack swap-refund">
            <p className="swap-hint muted">
              Locked USDC but the swap stalled? Reclaim it on-chain
              {refundReadyAt && ` (available after ${refundReadyAt})`}.
            </p>
            <button
              type="button"
              className="link-btn danger-btn"
              disabled={busy || !evm}
              onClick={() => void onRefundUsdc()}
            >
              {stage === "refunding" ? "Refunding…" : "Refund locked USDC"}
            </button>
          </div>
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
            {quoting ? (
              <div className="swap-amount-skeleton" aria-hidden="true" />
            ) : (
              <input
                className="swap-amount"
                readOnly
                placeholder="0"
                value={estNock != null ? estNock.toFixed(2) : ""}
              />
            )}
            <span className="swap-token-pill">NOCK</span>
          </div>
        </div>
      </div>

      {quoting ? (
        <p className="swap-rate quoting" role="status" aria-live="polite">
          Finding your best rate
          <span className="quote-dots" aria-hidden="true"><span></span><span></span><span></span></span>
        </p>
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