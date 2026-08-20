/**
 * A two-button picker for the short codes the shop writes on the paper job
 * log — HT/DV and CO/TM. Buttons rather than a dropdown because there are only
 * ever two choices and both should be visible without a click.
 *
 * Clicking the selected button clears it, so a wrong entry can be undone
 * without reloading the form.
 */
interface CodePickerProps<T extends string> {
  value: T | null | undefined;
  onChange: (value: T | null) => void;
  options: ReadonlyArray<{ code: T; label: string }>;
  testId?: string;
}

export default function CodePicker<T extends string>({
  value,
  onChange,
  options,
  testId,
}: CodePickerProps<T>) {
  return (
    <div className="grid grid-cols-2 gap-2" data-testid={testId}>
      {options.map(({ code, label }) => {
        const selected = value === code;
        return (
          <button
            key={code}
            type="button"
            data-testid={testId ? `${testId}-${code}` : undefined}
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : code)}
            className={`rounded-md border px-2.5 py-2 text-left transition-colors ${
              selected
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border bg-secondary text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
            }`}
          >
            <span className={`block font-mono text-sm font-bold ${selected ? "text-primary" : ""}`}>
              {code}
            </span>
            <span className="block text-[10px] leading-tight mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Small inline badge for showing a code on a job row or detail page. */
export function CodeBadge({ code, title }: { code: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold bg-secondary text-muted-foreground border border-border"
    >
      {code}
    </span>
  );
}
