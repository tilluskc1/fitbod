interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function ChevronIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.6}>
      <path d="m9.5 5.5 7 6.5-7 6.5" />
    </svg>
  );
}

export function ArrowIcon({ size = 19 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.8}>
      <path d="M4 12h15M13.5 6.5 20 12l-6.5 5.5" />
    </svg>
  );
}

export function ClockIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3.2 2" />
    </svg>
  );
}

export function CheckIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="m5 12.6 4.4 4.4L19 6.6" />
    </svg>
  );
}

export function DownloadIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3.8v10.4M7.8 10.4 12 14.6l4.2-4.2" />
      <path d="M4.4 16.6v2.2a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6v-2.2" />
    </svg>
  );
}

export function EditIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 20h4.2L19.3 8.9a2.2 2.2 0 0 0 0-3.1l-1.1-1.1a2.2 2.2 0 0 0-3.1 0L4 15.8z" />
      <path d="m13.8 5.9 4.3 4.3" />
    </svg>
  );
}

export function LockIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="4.6" y="10.4" width="14.8" height="9.8" rx="2.2" />
      <path d="M8.4 10.4V8.2a3.6 3.6 0 0 1 7.2 0v2.2" />
    </svg>
  );
}

export function BackIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.9}>
      <path d="m14 5.5-6.5 6.5 6.5 6.5" />
    </svg>
  );
}

export function CloseIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.9}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function GoalIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 21a9 9 0 1 0-9-9" />
      <path d="M12 16.4A4.4 4.4 0 1 0 7.6 12" />
      <path d="M3 12h3.2M12 3v3.2M20.4 4 12 12.4" />
    </svg>
  );
}

export function DumbbellIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.6}>
      <path d="M3.4 9.6v4.8M6.6 7.6v8.8M17.4 7.6v8.8M20.6 9.6v4.8M6.6 12h10.8" />
    </svg>
  );
}

export function SettingsIcon({ size = 21 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h8M16 7h4M4 17h4M12 17h8" />
      <circle cx="14" cy="7" r="2.2" />
      <circle cx="10" cy="17" r="2.2" />
    </svg>
  );
}

export function BarIcon({ size = 40 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2.4} aria-hidden>
      <path d="M7 20v-6M12 20V8M17 20v-9" />
    </svg>
  );
}
