/** Tiny env helpers — read Vite `import.meta.env` safely in app + tests. */

export function readEnv(key: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const v = env?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function isDev(): boolean {
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  return env?.DEV ?? false;
}
