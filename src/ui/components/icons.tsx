import { faGear, faLock, faPlus } from "@fortawesome/free-solid-svg-icons";

/** Font Awesome icon definition (path data + viewBox dims). */
type FaDef = typeof faGear;

/** Render a Font Awesome icon as an inline SVG (no CDN, inherits `currentColor`). */
function FaSvg({
  icon,
  size = 18,
  className,
}: {
  icon: FaDef;
  size?: number;
  className?: string;
}) {
  const [w, h, , , d] = icon.icon;
  const path = Array.isArray(d) ? d.join(" ") : d;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${w} ${h}`}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

export type IconProps = { size?: number; className?: string };

export const GearIcon = (p: IconProps) => <FaSvg icon={faGear} {...p} />;
export const LockIcon = (p: IconProps) => <FaSvg icon={faLock} {...p} />;
export const PlusIcon = (p: IconProps) => <FaSvg icon={faPlus} {...p} />;
