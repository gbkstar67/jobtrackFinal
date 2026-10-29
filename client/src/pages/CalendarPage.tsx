import { useEffect, useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import TaskRow from "@/components/TaskRow";
import TaskDialog from "@/components/TaskDialog";
import { Button } from "@/components/ui/button";
import { FadeBar } from "@/components/Brand";
import { localToday } from "@/lib/dates";
import {
  addDays, agendaRange, dayHeading, groupByDay, jobHue,
  monthGridRange, monthLabel, monthOf, parseLocal, shiftMonth,
} from "@/lib/calendarRange";
import type { Task, Job, Employee } from "@shared/schema";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, CalendarDaysIcon } from "lucide-react";

/**
 * Agenda on phones, month grid from 768px up.
 *
 * A 7-column month grid on a 375px screen gives each day ~50px, which cannot
 * show a task title — so the phone default is a scrolling agenda, which is
 * also what someone standing in a mechanical room actually reads.
 */
export default function CalendarPage() {
  const today = localToday();
  useMidnightTick(today);

  const [view, setView] = useState<"agenda" | "month">(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "agenda" : "month",
  );
  const [cursor, setCursor] = useState(() => monthOf(today));
  const [anchor, setAnchor] = useState(today);
  const [sheetDay, setSheetDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [addDate, setAddDate] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);

  const { from, to, days } = view === "month" ? monthGridRange(cursor) : agendaRange(anchor);

  // One query key, one whole URL — the default queryFn joins key parts with
  // "/", and invalidatePath("/api/tasks") matches anything starting
  // "/api/tasks?", so ticking a task off anywhere refreshes this for free.
  const { data: tasks = [], isLoading, isError } = useQuery<Task[]>({
    queryKey: [`/api/tasks?view=range&from=${from}&to=${to}`],
  });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });

  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const byDay = groupByDay(tasks);

  const openAdd = (date?: string) => { setAddDate(date); setAdding(true); };

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {view === "month" ? monthLabel(cursor) : "Next 45 days"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1">
            {(["agenda", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`cal-view-${v}`}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold capitalize ${
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <Button
            data-testid="button-cal-new-task"
            onClick={() => openAdd(view === "month" ? undefined : today)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-2 tracking-wide"
          >
            <PlusIcon className="w-4 h-4" /> New Task
          </Button>
        </div>
      </div>

      {/* Window controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="cal-prev"
          onClick={() => (view === "month" ? setCursor(shiftMonth(cursor, -1)) : setAnchor(addDays(anchor, -14)))}
          className="sheet-card px-3 py-2 hover:border-primary"
          aria-label="Previous"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          data-testid="cal-today"
          onClick={() => { setCursor(monthOf(today)); setAnchor(today); }}
          className="sheet-card px-3 py-2 text-sm font-semibold hover:border-primary"
        >
          Today
        </button>
        <button
          type="button"
          data-testid="cal-next"
          onClick={() => (view === "month" ? setCursor(shiftMonth(cursor, 1)) : setAnchor(addDays(anchor, 14)))}
          className="sheet-card px-3 py-2 hover:border-primary"
          aria-label="Next"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="sheet-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "hsl(var(--navy))" }}>
          <div className="flex items-center gap-3">
            <h2 className="font-display font-extrabold text-sm text-white uppercase tracking-widest">
              {view === "month" ? monthLabel(cursor) : "Agenda"}
            </h2>
            <FadeBar className="h-[9px] w-[46px] opacity-70" color="hsl(var(--primary-foreground))" />
          </div>
          <span className="font-mono text-xs text-white/70">{tasks.length}</span>
        </div>

        {isError ? (
          <div className="p-10 text-center text-muted-foreground">Couldn't load the calendar.</div>
        ) : isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-12 bg-secondary/60 rounded animate-pulse" />)}
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-12 text-center">
            <CalendarDaysIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">Add a job first — tasks hang off jobs.</p>
          </div>
        ) : view === "month" ? (
          <MonthGrid
            days={days}
            cursor={cursor}
            today={today}
            byDay={byDay}
            jobMap={jobMap}
            onDay={setSheetDay}
          />
        ) : (
          <Agenda
            days={days}
            today={today}
            byDay={byDay}
            jobMap={jobMap}
            empMap={empMap}
            onOpen={setEditing}
            onAdd={openAdd}
          />
        )}
      </div>

      {/* A day's full list, for month view where a cell can only show two */}
      {sheetDay && (
        <div className="sheet-card overflow-hidden" data-testid="cal-day-sheet">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-display font-extrabold text-sm uppercase tracking-widest">
              {dayHeading(sheetDay, today)}
            </h3>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => openAdd(sheetDay)} className="text-xs font-semibold text-primary hover:underline">
                Add here
              </button>
              <button type="button" onClick={() => setSheetDay(null)} className="text-xs text-muted-foreground hover:text-foreground">
                Close
              </button>
            </div>
          </div>
          {(byDay.get(sheetDay) ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nothing on this day.</p>
          ) : (
            <div className="divide-y divide-border">
              {(byDay.get(sheetDay) ?? []).map((t) => (
                <TaskRow key={t.id} task={t} job={jobMap.get(t.jobId)}
                         assignee={t.assignedTo ? empMap.get(t.assignedTo) : undefined}
                         onOpen={setEditing} />
              ))}
            </div>
          )}
        </div>
      )}

      <TaskDialog
        open={adding || editing !== null}
        task={editing}
        jobs={jobs}
        employees={employees.filter((e) => e.active)}
        defaultDate={addDate}
        onClose={() => { setAdding(false); setEditing(null); setAddDate(undefined); }}
      />
    </AppShell>
  );
}

function MonthGrid({ days, cursor, today, byDay, jobMap, onDay }: {
  days: string[]; cursor: string; today: string;
  byDay: Map<string, Task[]>; jobMap: Map<number, Job>; onDay: (d: string) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border bg-secondary/60">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d} className="label-caps px-2 py-2 text-center">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date) => {
          const items = byDay.get(date) ?? [];
          const outside = monthOf(date) !== cursor;
          const isToday = date === today;
          return (
            <button
              key={date}
              type="button"
              data-testid={`cal-day-${date}`}
              onClick={() => onDay(date)}
              className={`min-h-[86px] border-b border-r border-border p-1.5 text-left align-top transition-colors hover:bg-accent/60 ${
                outside ? "bg-secondary/30" : ""
              }`}
            >
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold mb-1 ${
                isToday ? "bg-primary text-primary-foreground" : outside ? "text-muted-foreground/50" : "text-foreground"
              }`}>
                {Number(date.slice(8))}
              </span>
              <div className="space-y-0.5">
                {items.slice(0, 2).map((t) => {
                  const job = jobMap.get(t.jobId);
                  return (
                    <span
                      key={t.id}
                      title={`${job?.jobNumber ?? ""} ${t.title}`}
                      className={`block truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                        t.completedAt ? "line-through opacity-50" : ""
                      }`}
                      style={{
                        background: `hsl(${jobHue(t.jobId)} 70% 94%)`,
                        color: `hsl(${jobHue(t.jobId)} 70% 28%)`,
                      }}
                    >
                      {t.dueTime ? `${t.dueTime} ` : ""}{t.title}
                    </span>
                  );
                })}
                {items.length > 2 && (
                  <span className="block px-1 text-[10px] font-semibold text-muted-foreground">
                    +{items.length - 2} more
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ days, today, byDay, jobMap, empMap, onOpen, onAdd }: {
  days: string[]; today: string; byDay: Map<string, Task[]>;
  jobMap: Map<number, Job>; empMap: Map<number, Employee>;
  onOpen: (t: Task) => void; onAdd: (d: string) => void;
}) {
  // Only days with something on them, so the list is not 45 empty headings.
  const populated = days.filter((d) => (byDay.get(d) ?? []).length > 0);

  if (!populated.length) {
    return (
      <div className="p-12 text-center">
        <CalendarDaysIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
        <p className="text-muted-foreground font-medium">Nothing scheduled in this window.</p>
        <button type="button" onClick={() => onAdd(today)} className="mt-3 text-sm font-semibold text-primary hover:underline">
          Add something for today
        </button>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {populated.map((date) => (
        <div key={date}>
          <div className="px-4 py-2 bg-secondary/50 flex items-center justify-between sticky top-[57px] z-[5]">
            <span className={`label-caps ${date === today ? "text-primary" : ""}`}>
              {dayHeading(date, today)}
            </span>
            <button type="button" onClick={() => onAdd(date)} className="text-xs text-muted-foreground hover:text-primary">
              + Add
            </button>
          </div>
          <div className="divide-y divide-border">
            {(byDay.get(date) ?? []).map((t) => (
              <TaskRow key={t.id} task={t} job={jobMap.get(t.jobId)}
                       assignee={t.assignedTo ? empMap.get(t.assignedTo) : undefined}
                       onOpen={onOpen} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Re-render at local midnight so a page left open overnight in a parked truck
 * does not keep "Today" on yesterday.
 */
function useMidnightTick(today: string) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    // parseLocal gives local NOON, so next midnight is tomorrow-noon minus 12h.
    const at = parseLocal(addDays(today, 1)).getTime() - 12 * 3_600_000;
    const timer = setTimeout(tick, Math.max(1_000, at - Date.now()) + 1_000);
    return () => clearTimeout(timer);
  }, [today]);
}
