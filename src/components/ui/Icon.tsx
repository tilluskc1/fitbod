interface Props {
  name: string;
  size?: number;
  className?: string;
  filled?: boolean;
  /** Accessible name. Omit for icons that sit next to visible text. */
  label?: string;
}

/**
 * Material Symbols glyph. The font is self-hosted (subset, ligatures only) so
 * no request leaves the device at runtime.
 */
export default function Icon({ name, size = 20, className = '', filled = false, label }: Props) {
  return (
    <span
      className={`ms ${filled ? 'ms--fill' : ''} ${className}`.trim()}
      style={{ fontSize: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {name}
    </span>
  );
}
