import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, invalidatePath } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import CodePicker from "@/components/CodePicker";
import { localToday } from "@/lib/dates";
import { REPEAT_RULES, REMINDER_LEADS, type Task, type Job, type Employee } from "@shared/schema";
import { Trash2Icon } from "lucide-react";

/**
 * Add or edit a task.
 *
 * The title is the only required field. Everything else is a tap, because this
 * gets filled in between the trailer and the truck — if it takes a keyboard and
 * four decisions, it doesn't get written down at all.
 */
/**
 * Turn a due date/time plus a lead time into the instant the sweep compares
 * against. A task with no time is treated as 8am — a day-level reminder that
 * fires at midnight is one nobody sees.
 */
function remindAtFor(dueDate: string, dueTime: string, lead: string): string | null {
  if (!dueDate || lead === "none") return null;
  const [h, m] = (dueTime || "08:00").split(":").map(Number);
  const [y, mo, d] = dueDate.split("-").map(Number);
  const due = new Date(y, mo - 1, d, h, m, 0, 0);     // local, like the viewer means it
  return new Date(due.getTime() - Number(lead) * 60_000).toISOString();
}

function leadFromRemindAt(dueDate: string, dueTime: string | null, remindAt: string): string {
  const [h, m] = (dueTime || "08:00").split(":").map(Number);
  const [y, mo, d] = dueDate.split("-").map(Number);
  const due = new Date(y, mo - 1, d, h, m, 0, 0).getTime();
  const mins = Math.round((due - new Date(remindAt).getTime()) / 60_000);
  return String(mins in REMINDER_LEADS ? mins : 0);
}

export default function TaskDialog({
  open,
  task,
  jobs,
  employees,
  defaultJobId,
  defaultDate,
  onClose,
}: {
  open: boolean;
  task: Task | null;
  jobs: Job[];
  employees: Employee[];
  defaultJobId?: number;
  /** Pre-fill the due date — used when adding from a calendar day. */
  defaultDate?: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const editing = Boolean(task);

  const [title, setTitle] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent" | null>("normal");
  const [assignedTo, setAssignedTo] = useState<string>("none");
  const [repeatRule, setRepeatRule] = useState<string>("none");
  const [notes, setNotes] = useState("");
  const [remindLead, setRemindLead] = useState<string>("none");

  // Re-seed whenever the dialog opens or switches task, so an edit never shows
  // the previous task's values for a beat.
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setJobId(String(task?.jobId ?? defaultJobId ?? jobs[0]?.id ?? ""));
    setDueDate(task?.dueDate ?? defaultDate ?? "");
    setDueTime(task?.dueTime ?? "");
    setPriority((task?.priority as "normal" | "urgent") ?? "normal");
    setAssignedTo(task?.assignedTo ? String(task.assignedTo) : "none");
    setRepeatRule(task?.repeatRule ?? "none");
    setNotes(task?.notes ?? "");
    // Recover the lead time from the stored instant so editing shows what was
    // chosen rather than resetting to "no reminder".
    setRemindLead(task?.remindAt && task?.dueDate ? leadFromRemindAt(task.dueDate, task.dueTime, task.remindAt) : "none");
  }, [open, task, defaultJobId, defaultDate, jobs]);

  const refresh = () => {
    invalidatePath("/api/tasks");
    invalidatePath("/api/jobs/task-summary");
    invalidatePath("/api/activity");
  };

  const payload = () => ({
    jobId: parseInt(jobId, 10),
    title: title.trim(),
    notes: notes.trim() || null,
    dueDate: dueDate || null,
    dueTime: dueTime || null,
    priority: priority ?? "normal",
    assignedTo: assignedTo === "none" ? null : parseInt(assignedTo, 10),
    repeatRule: repeatRule === "none" ? null : repeatRule,
    remindAt: remindAtFor(dueDate, dueTime, remindLead),
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiRequest("PATCH", `/api/tasks/${task!.id}`, payload())
        : apiRequest("POST", "/api/tasks", payload()),
    onSuccess: () => {
      refresh();
      toast({ title: editing ? "Task updated" : "Task added" });
      onClose();
    },
    onError: () => toast({ title: "Couldn't save that task", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/tasks/${task!.id}`),
    onSuccess: () => { refresh(); toast({ title: "Task deleted" }); onClose(); },
    onError: () => toast({ title: "Couldn't delete that task", variant: "destructive" }),
  });

  const quickDate = (offsetDays: number) => {
    const d = new Date(`${localToday()}T00:00:00`);
    d.setDate(d.getDate() + offsetDays);
    setDueDate(d.toLocaleDateString("en-CA"));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-widest">
            {editing ? "Edit Task" : "New Task"}
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4 mt-2"
          onSubmit={(e) => { e.preventDefault(); if (title.trim() && jobId) save.mutate(); }}
        >
          <div className="space-y-2">
            <label className="label-caps" htmlFor="task-title">What needs doing *</label>
            <Input
              id="task-title"
              data-testid="input-task-title"
              autoFocus
              placeholder="Call engineer about the damper submittal"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-background border-border text-foreground"
            />
          </div>

          <div className="space-y-2">
            <label className="label-caps" htmlFor="task-job">Which job *</label>
            <select
              id="task-job"
              data-testid="select-task-job-field"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {jobs.map((j) => (
                <option key={j.id} value={String(j.id)}>{j.jobNumber} · {j.jobName}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="label-caps">When</label>
            <div className="flex gap-2 flex-wrap">
              {[["Today", 0], ["Tomorrow", 1], ["Next week", 7]].map(([label, off]) => (
                <button
                  key={label as string}
                  type="button"
                  onClick={() => quickDate(off as number)}
                  className="rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-semibold hover:border-primary hover:text-primary"
                >
                  {label as string}
                </button>
              ))}
              {dueDate && (
                <button
                  type="button"
                  onClick={() => { setDueDate(""); setDueTime(""); }}
                  className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input type="date" data-testid="input-task-date" value={dueDate}
                     onChange={(e) => setDueDate(e.target.value)}
                     className="bg-background border-border text-foreground" />
              <Input type="time" data-testid="input-task-time" value={dueTime}
                     onChange={(e) => setDueTime(e.target.value)}
                     disabled={!dueDate}
                     title={dueDate ? "Adding a time puts it on the calendar" : "Pick a day first"}
                     className="bg-background border-border text-foreground disabled:opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground">Add a time and it lands on the calendar.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="label-caps">Priority</label>
              <CodePicker<"normal" | "urgent">
                testId="picker-task-priority"
                value={priority}
                onChange={(v) => setPriority(v ?? "normal")}
                options={[
                  { code: "normal", label: "Normal" },
                  { code: "urgent", label: "Urgent" },
                ]}
              />
            </div>

            <div className="space-y-2">
              <label className="label-caps" htmlFor="task-assignee">Who</label>
              <select
                id="task-assignee"
                data-testid="select-task-assignee-field"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="none">Anyone</option>
                {employees.map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="label-caps" htmlFor="task-repeat">Repeat</label>
            <select
              id="task-repeat"
              data-testid="select-task-repeat"
              value={repeatRule}
              onChange={(e) => setRepeatRule(e.target.value)}
              disabled={!dueDate}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="none">Doesn't repeat</option>
              {Object.entries(REPEAT_RULES).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            {repeatRule !== "none" && (
              <p className="text-xs text-muted-foreground">
                The next one is created when you tick this off.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="label-caps" htmlFor="task-remind">Remind me</label>
            <select
              id="task-remind"
              data-testid="select-task-remind"
              value={remindLead}
              onChange={(e) => setRemindLead(e.target.value)}
              disabled={!dueDate}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="none">No reminder</option>
              {Object.entries(REMINDER_LEADS).map(([mins, label]) => (
                <option key={mins} value={mins}>{label}</option>
              ))}
            </select>
            {!dueDate && <p className="text-xs text-muted-foreground">Pick a day first.</p>}
          </div>

          <div className="space-y-2">
            <label className="label-caps" htmlFor="task-notes">Notes</label>
            <Textarea
              id="task-notes"
              data-testid="input-task-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-background border-border text-foreground resize-none"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            {editing ? (
              <button
                type="button"
                data-testid="button-delete-task"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon className="w-3.5 h-3.5" /> Delete
              </button>
            ) : <span />}
            <div className="flex gap-3">
              <Button type="button" variant="ghost" onClick={onClose} className="text-muted-foreground">
                Cancel
              </Button>
              <Button
                type="submit"
                data-testid="button-save-task"
                disabled={save.isPending || !title.trim() || !jobId}
                className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-wide"
              >
                {save.isPending ? "Saving..." : editing ? "Save" : "Add Task"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
