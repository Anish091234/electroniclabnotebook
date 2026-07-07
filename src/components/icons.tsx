interface IconProps {
  color?: string;
  size?: number;
}

export function LogoMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="5" height="5" rx="1" fill="white" />
      <rect x="9" y="2" width="5" height="5" rx="1" fill="white" opacity=".6" />
      <rect x="2" y="9" width="5" height="5" rx="1" fill="white" opacity=".6" />
      <rect x="9" y="9" width="5" height="5" rx="1" fill="#93c5fd" />
    </svg>
  );
}

export function DashboardIcon({ color = "#94a3b8", size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" fill={color} />
      <rect x="8" y="1" width="5" height="5" rx="1" fill={color} />
      <rect x="1" y="8" width="5" height="5" rx="1" fill={color} />
      <rect x="8" y="8" width="5" height="5" rx="1" fill={color} opacity=".6" />
    </svg>
  );
}

export function ExperimentsIcon({ color = "#94a3b8", size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="2" rx="1" fill={color} />
      <rect x="1" y="6" width="12" height="2" rx="1" fill={color} />
      <rect x="1" y="10" width="7" height="2" rx="1" fill={color} />
    </svg>
  );
}

export function ProtocolsIcon({ color = "#94a3b8", size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1.5L1.5 4.5v4c0 2.5 2 4.9 5.5 5.6C10.5 13.4 12.5 11 12.5 8.5v-4L7 1.5z"
        stroke={color}
        strokeWidth="1.3"
        fill="none"
      />
    </svg>
  );
}

export function InventoryIcon({ color = "#94a3b8", size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <rect x="1" y="3" width="12" height="8" rx="1.5" stroke={color} strokeWidth="1.2" fill="none" />
      <path d="M3.5 7h7M3.5 9h4" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function AnalyticsIcon({ color = "#94a3b8", size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2 10h2v3H2zM5.5 7h2v6H5.5zM9 4h2v9H9zM12 1.5h.5v11.5H12z" fill={color} />
    </svg>
  );
}

export function TeamIcon({ color = "#94a3b8", size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="4.5" r="2.5" stroke={color} strokeWidth="1.2" fill="none" />
      <path
        d="M2.5 12.5c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function AuditLogIcon({ color = "#94a3b8", size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.2" fill="none" />
      <path d="M7 4v3.5l2 2" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function SparkleIcon({ color = "white", size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="2" fill={color} />
      <path
        d="M6 1v1.4M6 9.6V11M1 6h1.4M9.6 6H11M2.5 2.5l1 1M8.5 8.5l1 1M2.5 9.5l1-1M8.5 3.5l1-1"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SunIcon({ color = "currentColor", size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="2.5" stroke={color} strokeWidth="1.3" />
      <path
        d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1.1 1.1M10.1 10.1l1.1 1.1M2.8 11.2l1.1-1.1M10.1 3.9l1.1-1.1"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonIcon({ color = "currentColor", size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M11.5 8.7A4.8 4.8 0 0 1 5.3 2.5 4.8 4.8 0 1 0 11.5 8.7Z"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SearchIcon({ color = "#94a3b8", size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <circle cx="5" cy="5" r="3.5" stroke={color} strokeWidth="1.2" fill="none" />
      <path d="M8 8l2.5 2.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ color = "white", size = 8 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" fill="none">
      <path d="M1.5 4l2 2 3-3.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertIcon({ color = "white", size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="3" fill={color} />
      <path d="M7.5 2v1.5M7.5 11.5V13M2 7.5h1.5M11.5 7.5H13" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
