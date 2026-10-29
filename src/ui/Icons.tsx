import type { ReactNode } from 'react';
import type { Status } from '../domain/planner';

/// Line icons drawn after the phone's Cupertino set. Each takes the text
/// colour, so tokens colour them.
function Svg({ size = 18, children, className }: { size?: number; children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type P = { size?: number; className?: string };

export const Plus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const Close = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const Search = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Svg>
);
export const FilterIcon = ({ on, ...p }: P & { on?: boolean }) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" fill={on ? 'currentColor' : 'none'} />
    <path d="M7.5 9h9M9.5 12.5h5M11 16h2" stroke={on ? 'var(--card)' : 'currentColor'} />
  </Svg>
);
export const ListIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r=".6" fill="currentColor" />
    <circle cx="4.5" cy="12" r=".6" fill="currentColor" />
    <circle cx="4.5" cy="18" r=".6" fill="currentColor" />
  </Svg>
);
export const BoardIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M12 4.5v15" />
  </Svg>
);
export const Sliders = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Svg>
);
export const Gear = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
  </Svg>
);
export const Refresh = (p: P) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4v4.5h-4.5" />
  </Svg>
);
export const Download = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
  </Svg>
);
export const Chevron = ({ up, ...p }: P & { up?: boolean }) => (
  <Svg {...p}>
    <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
  </Svg>
);
/// A window with its side panel: hides or shows the sidebar.
export const SidebarIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
  </Svg>
);
export const Calendar = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const Timer = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="13" r="7.5" />
    <path d="M12 9v4l2.5 2M10 2.8h4" />
  </Svg>
);
export const Indent = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h16M10 12h10M10 18h10M4 10.5l3 2-3 2" />
  </Svg>
);
export const Flame = (p: P) => (
  <Svg {...p}>
    <path
      d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.6-5.4 3.7-8.3.3 1.9 1.4 3 2.4 3.5.2-2.9 1.6-5.4 3.8-7 0 3.1 1.4 4.6 2.6 6.4 1 1.4 1.5 3 1.5 4.7 0 4.3-3 6.9-7.5 6.9z"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);
export const Copy = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Svg>
);
export const Trash = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />
  </Svg>
);
export const LinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);
export const Checklist = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M7.5 9l1.5 1.5L11.5 8M7.5 15l1.5 1.5 2.5-2.5M14 9.5h3M14 15.5h3" />
  </Svg>
);
export const Seal = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l2.2 1.6 2.7-.2.9 2.6 2.3 1.5-.8 2.6.8 2.6-2.3 1.5-.9 2.6-2.7-.2L12 21l-2.2-1.6-2.7.2-.9-2.6-2.3-1.5.8-2.6-.8-2.6 2.3-1.5.9-2.6 2.7.2z" />
    <path d="M8.8 12l2.2 2.2 4.2-4.4" />
  </Svg>
);
export const Sparkles = (p: P) => (
  <Svg {...p}>
    <path d="M11 3.5l1.6 4.4 4.4 1.6-4.4 1.6L11 15.5l-1.6-4.4L5 9.5l4.4-1.6zM18 14l.8 2.2 2.2.8-2.2.8L18 20l-.8-2.2-2.2-.8 2.2-.8z" />
  </Svg>
);

export const Play = (p: P) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </Svg>
);
export const Pause = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.6" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const Stop = (p: P) => (
  <Svg {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" />
  </Svg>
);
export const Leaf = (p: P) => (
  <Svg {...p}>
    <path d="M5 19c0-8 5-13.5 14-14-.3 9-6 14-14 14z" />
    <path d="M5 19l7.5-7.5" />
  </Svg>
);
export const Expand = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 9.5v-5h5M19.5 9.5v-5h-5M4.5 14.5v5h5M19.5 14.5v5h-5" />
  </Svg>
);
export const Check = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

/// The phone's status circle icons.
export function StatusIcon({ status, size = 22 }: { status: Status; size?: number }) {
  return (
    <svg className={`status-icon s-${status}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {status === 'todo' && <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.8" />}
      {status === 'doing' && (
        <>
          <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 3.4a8.6 8.6 0 0 0 0 17.2z" fill="currentColor" />
        </>
      )}
      {status === 'done' && (
        <>
          <circle cx="12" cy="12" r="9.5" fill="currentColor" />
          <path d="M7.8 12.3l2.8 2.8 5.6-5.8" fill="none" stroke="var(--card)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === 'cancelled' && (
        <>
          <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {status === 'backlog' && (
        <g fill="currentColor">
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <circle key={deg} cx={12 + 7.6 * Math.cos((deg * Math.PI) / 180)} cy={12 + 7.6 * Math.sin((deg * Math.PI) / 180)} r="1.5" />
          ))}
          <circle cx="12" cy="12" r="1.5" />
        </g>
      )}
    </svg>
  );
}

/// Linear-style bars: one to three for low to high, a filled warning sign
/// for urgent, a dash for none.
export function PriorityIcon({ priority, size = 16 }: { priority: number; size?: number }) {
  if (priority >= 4) {
    return (
      <svg className="prio-icon urgent" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="3" width="18" height="18" rx="4.5" fill="currentColor" />
        <path d="M12 7.5v5.5" stroke="var(--card)" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="12" cy="16.6" r="1.4" fill="var(--card)" />
      </svg>
    );
  }
  if (priority <= 0) {
    return (
      <svg className="prio-icon none" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="prio-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {[1, 2, 3].map((i) => {
        const h = 24 * (0.35 + 0.2 * i);
        return (
          <rect
            key={i}
            x={2.4 + (i - 1) * 7.2}
            y={24 - h}
            width="4.8"
            height={h}
            rx="1"
            className={i <= priority ? 'bar on' : 'bar'}
          />
        );
      })}
    </svg>
  );
}
