import { formatNock, parseNockToNicks } from "../../nock/units.js";
import { MIN_NOCK_AMOUNT } from "../../swap/config.js";
import type { SellAffordability } from "../../swap/nock/balance.js";

export function nicksToNock(nicks: bigint | undefined): string {
  if (nicks == null) return "";
  return formatNock(nicks, 4);
}

export function nockToNicks(value: string): bigint {
  if (!value.trim()) return 0n;
  try {
    return parseNockToNicks(value);
  } catch {
    return 0n;
  }
}

export function belowMinNock(nockAmount: number): boolean {
  return !Number.isFinite(nockAmount) || nockAmount < MIN_NOCK_AMOUNT;
}

export function minNockAmountError(): string {
  return `Minimum NOCK amount is ${MIN_NOCK_AMOUNT} NOCK (to cover on-chain fees).`;
}

export function sellInsufficientBalanceError(
  giftNicks: bigint,
  totalNicks: bigint,
  affordability: SellAffordability
): string {
  return (
    `Insufficient balance — you have ${formatNock(totalNicks, 2)} NOCK but need ` +
    `${formatNock(giftNicks, 2)} + ~${formatNock(affordability.feeNicks, 4)} fee ` +
    `(${formatNock(affordability.needNicks, 2)} total).`
  );
}

export function sellFragmentedBalanceError(
  giftNicks: bigint,
  totalNicks: bigint,
  largestNicks: bigint,
  affordability: SellAffordability
): string {
  return (
    `Your largest note is ${formatNock(largestNicks, 2)} NOCK, but you hold ${formatNock(totalNicks, 2)} NOCK ` +
    `across multiple notes. Selling ${formatNock(giftNicks, 2)} NOCK needs one note of at least ` +
    `${formatNock(affordability.needNicks, 2)} NOCK (amount + ~${formatNock(affordability.feeNicks, 4)} fee) — consolidate first.`
  );
}

export function swapUrl(hEvm: string | undefined): string {
  if (!hEvm || typeof window === "undefined") return "";
  return `${window.location.origin}/swap/${hEvm}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}