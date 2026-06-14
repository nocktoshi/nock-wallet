import type { SolverRfqResponse } from "../../market/solver-rfq.js";
import { useSolverRfqQuote } from "./useSolverRfqQuote.js";

export interface NockSellQuoteState {
  loading: boolean;
  quote: SolverRfqResponse | null;
  error: string | null;
  online: boolean | null;
}

export function useNockSellQuote(nockAmount: string): NockSellQuoteState {
  return useSolverRfqQuote("sell", nockAmount);
}