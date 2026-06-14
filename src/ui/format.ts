import { useCallback, useState } from "react";

/** Shorten a long id/address as `head…tail`. */
export function shortMiddle(s: string, head = 8, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Clipboard copy with a transient "copied" flag for button feedback. */
export function useCopy(timeoutMs = 1200): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard?.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), timeoutMs);
      });
    },
    [timeoutMs]
  );
  return [copied, copy];
}
