/**
 * HL Thomas house marks, redrawn from the estimating sheet letterhead.
 *
 * Everything here is inline SVG rather than an image file: it stays sharp at
 * any size, picks up the theme colours, and adds nothing to load.
 */

/** The circular HLT badge — navy disc, white monogram, blue arc. */
export function HLTBadge({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <svg
      aria-label="HL Thomas Inc"
      viewBox="0 0 48 48"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="24" r="23" fill="hsl(var(--primary))" />
      <text
        x="24"
        y="24.5"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        fontFamily="var(--font-display)"
        fontSize="15"
        fontWeight="800"
        letterSpacing="-0.5"
      >
        HLT
      </text>
    </svg>
  );
}

/**
 * The squares-into-lines bar that runs beside "Contractors" on the letterhead.
 * Solid blocks on the left thinning to hairlines on the right.
 */
export function FadeBar({
  className = "",
  color = "hsl(var(--primary))",
}: { className?: string; color?: string }) {
  // Widths step down from a solid block to a hairline; gaps stay constant.
  const bars = [4, 4, 4, 4, 3.2, 2.6, 2, 1.6, 1.2, 1, 1, 1];
  let x = 0;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 46 14"
      className={className}
      preserveAspectRatio="xMinYMid meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      {bars.map((w, i) => {
        const rect = <rect key={i} x={x} y={0} width={w} height={14} fill={color} />;
        x += w + 1.4;
        return rect;
      })}
    </svg>
  );
}

/**
 * "JOBTRACK" set the way the letterhead sets "HL THOMAS" — the first half in
 * house blue, the rest in near-black, tight and heavy.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-display font-extrabold tracking-tight leading-none select-none ${className}`}
    >
      <span className="text-primary">JOB</span>
      <span className="text-foreground">TRACK</span>
    </span>
  );
}

/** The company line, set wide and small like "VANDERBILT PA". */
export function CompanyLine({ className = "" }: { className?: string }) {
  return (
    <span className={`label-caps ${className}`}>HL Thomas Inc · Vanderbilt PA</span>
  );
}
