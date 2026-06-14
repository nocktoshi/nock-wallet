export interface StepperItem {
  id: string;
  label: string;
}

export function SwapStepper({
  steps,
  currentIndex,
}: {
  steps: StepperItem[];
  currentIndex: number;
}) {
  return (
    <nav className="swap-stepper" aria-label="Swap progress">
      {steps.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const pending = i > currentIndex;
        return (
          <div
            key={step.id}
            className={
              "swap-step" +
              (done ? " done" : "") +
              (active ? " active" : "") +
              (pending ? " pending" : "")
            }
          >
            <div className="swap-step-marker" aria-hidden="true">
              {done ? "✓" : i + 1}
            </div>
            <div className="swap-step-label">{step.label}</div>
            {i < steps.length - 1 && <div className="swap-step-line" aria-hidden="true" />}
          </div>
        );
      })}
    </nav>
  );
}