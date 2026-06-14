import { useState, type ReactNode } from "react";
import { useCopy } from "../format.js";

export function Screen({
  title,
  subtitle,
  children,
  footer,
}: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="screen">
      {title && <h2 className="screen-title" style={{color:"#7c5cff"}}>{title}</h2>}
      {subtitle && <p className="muted screen-sub">{subtitle}</p>}
      <div className="screen-body">{children}</div>
      {footer && <div className="screen-footer">{footer}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function PasswordInput({
  value,
  onChange,
  placeholder = "Password",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-input">
      <input
        type={show ? "text" : "password"}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)}>
        {show ? "hide" : "show"}
      </button>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, copy] = useCopy();
  return (
    <button type="button" onClick={() => copy(text)}>
      {copied ? "Copied ✓" : label}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" aria-hidden /> {label}
    </span>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="error-text mono-wrap">{children}</p>;
}
