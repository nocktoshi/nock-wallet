import type { SolverRfqResponse } from "../../market/solver-rfq.js";
import { useSolverRfqQuote } from "./useSolverRfqQuote.js";

export interface UsdcBuyQuoteState {
  loading: boolean;
  quote: SolverRfqResponse | null;
  error: string | null;
  online: boolean | null;
}

export function useUsdcBuyQuote(usdcAmount: string): UsdcBuyQuoteState {
  return useSolverRfqQuote("buy", usdcAmount);
}