export function formatGrpcError(err: unknown, depth = 0): string {
  if (depth > 5) return "(nested error)";
  if (err == null) return String(err);
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    if (err.message && err.message !== "[object Object]") return err.message;
    if (err.cause != null) return formatGrpcError(err.cause, depth + 1);
  }
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    for (const key of ["message", "reason", "details", "data"]) {
      const v = o[key];
      if (typeof v === "string" && v) return v;
    }
  }
  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}") return json;
  } catch {
    /* ignore */
  }
  return String(err);
}

export async function runStep<T>(step: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const detail = err instanceof Error && err.message ? err.message : formatGrpcError(err);
    throw new Error(`${step}: ${detail}`, { cause: err });
  }
}