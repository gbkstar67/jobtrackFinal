import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import TaskRow from "@/components/TaskRow";
import TaskDialog from "@/components/TaskDialog";
import Avatar from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { FadeBar } from "@/components/Brand";
import { localToday } from "@/lib/dates";
import type { Task, Job, Employee } from "@shared/schema";
import { PlusIcon, ClipboardCheckIcon } from "lucide-react";

const VIEWS = [
  { key: "today", label: "Today" },
  { key: "open", label: "Open" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Done" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

export default function TasksPage() {
  // Today opens on today, not on everything — the first thing a super needs is
  // what is late and what is happening in the next few hours.
  const [view, setView] = useState<ViewKey>("today");
  const [jobFilter, setJobFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Task | null>(null);
  const [adding, setAdding] = useState(false);

  const today = localToday();

  // today is sent as a header, not a param: keeping it out of the key is what
  // lets a persisted cache survive into the next morning.
  const params = new URLSearchParams({ view });
  if (jobFilter !== "all") params.set("jobId", jobFilter);
  if (assigneeFilter !== "all") params.set("assignedTo", assigneeFilter);

  // The whole URL is ONE query-key element on purpose: the default queryFn
  // joins key parts with "/", so a separate params element would be appended as
  // a path segment and match the /api/tasks/:id route instead.
  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: [`/api/tasks?${params.toString()}`],
  });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });

  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const activeEmployees = employees.filter((e) => e.active);

  const overdueCount = tasks.filter((t) => !t.completedAt && t.dueDate && t.dueDate < today).length;

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-foreground uppercase tracking-tight">
            Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {overdueCount > 0 ? (
              <span className="font-semibold text-destructive">
                {overdueCount} late
              </span>
            ) : (
              "Nothing late"
            )}
          </p>
        </div>
        <Button
          data-testid="button-new-task"
          onClick={() => setAdding(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-2 shadow-sm tracking-wide"
        >
          <PlusIcon className="w-4 h-4" />
          New Task
        </Button>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            data-testid={`tab-${v.key}`}
            onClick={() => setView(v.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors whitespace-nowrap ${
              view === v.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-primary hover:bg-accent"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          data-testid="select-task-job"
          value={jobFilter}
          onChange={(e) => setJobFilter(e.target.value)}
          className="sheet-card px-3 py-2 text-sm text-foreground sm:w-64"
        >
          <option value="all">All jobs</option>
          {jobs.map((j) => (
            <option key={j.id} value={String(j.id)}>
              {j.jobNumber} · {j.jobName}
            </option>
          ))}
        </select>

        {activeEmployees.length > 0 && (
          <select
            data-testid="select-task-assignee"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="sheet-card px-3 py-2 text-sm text-foreground sm:w-48"
          >
            <option value="all">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {activeEmployees.map((e) => (
              <option key={e.id} value={String(e.id)}>{e.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="sheet-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "hsl(var(--navy))" }}>
          <div className="flex items-center gap-3">
            <h2 className="font-display font-extrabold text-sm text-white uppercase tracking-widest">
              {VIEWS.find((v) => v.key === view)?.label}
            </h2>
            <FadeBar className="h-[9px] w-[46px] opacity-70" color="hsl(var(--primary-foreground))" />
          </div>
          <span className="font-mono text-xs text-white/70">{tasks.length}</span>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-secondary/60 rounded animate-pulse" />)}
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardCheckIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              {view === "done" ? "Nothing finished yet." : "Nothing here. Clear."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                job={jobMap.get(t.jobId)}
                assignee={t.assignedTo ? empMap.get(t.assignedTo) : undefined}
                onOpen={setEditing}
              />
            ))}
          </div>
        )}
      </div>

      <TaskDialog
        open={adding || editing !== null}
        task={editing}
        jobs={jobs}
        employees={activeEmployees}
        onClose={() => { setAdding(false); setEditing(null); }}
      />
    </AppShell>
  );
}
