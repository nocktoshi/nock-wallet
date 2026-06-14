import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Render a QR code for `value` as an <img> data URL. */
export function Qr({ value, size = 200 }: { value: string; size?: number }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: "#0e0f13", light: "#ffffff" },
    })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(""));
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (!src) return <div className="qr-placeholder" style={{ width: size, height: size }} />;
  return <img className="qr" src={src} width={size} height={size} alt="QR code" />;
}
