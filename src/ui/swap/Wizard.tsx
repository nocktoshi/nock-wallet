import { useState, type ComponentType } from "react";

export interface WizardStep<Ctx extends object> {
  id: string;
  title: string | ((ctx: Ctx) => string);
  Body: ComponentType<Ctx>;
  onNext?(ctx: Ctx): Promise<void> | void;
  nextLabel?: string | ((ctx: Ctx) => string);
  terminal?: boolean;
  canAdvance?(ctx: Ctx): boolean;
}

export function Wizard<Ctx extends object>({
  steps,
  index,
  ctx,
  onIndexChange,
  onError,
  actionsEnabled = true,
}: {
  steps: WizardStep<Ctx>[];
  index: number;
  ctx: Ctx;
  onIndexChange(i: number): void;
  onError(err: unknown): void;
  actionsEnabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const step = steps[index];
  const Body = step.Body;

  async function handleNext() {
    if (busy) return;
    setBusy(true);
    try {
      if (step.onNext) await step.onNext(ctx);
      onIndexChange(Math.min(steps.length - 1, index + 1));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  const title = typeof step.title === "function" ? step.title(ctx) : step.title;
  const nextLabel =
    typeof step.nextLabel === "function" ? step.nextLabel(ctx) : step.nextLabel;

  return (
    <div className="swap-wizard">
      <div className="swap-wizard-body panel">
        <Body {...ctx} />
      </div>
      <div className="swap-wizard-nav">
        <button type="button" disabled={index === 0 || busy} onClick={() => onIndexChange(index - 1)}>
          Back
        </button>
        {!step.terminal && (
          <button
            type="button"
            className="primary"
            disabled={
              busy ||
              !actionsEnabled ||
              (step.canAdvance ? !step.canAdvance(ctx) : false)
            }
            onClick={handleNext}
          >
            {busy ? "Working…" : (nextLabel ?? "Continue")}
          </button>
        )}
      </div>
      <div className="swap-wizard-title muted">{title}</div>
    </div>
  );
}