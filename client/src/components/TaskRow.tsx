import { useMutation } from "@tanstack/react-query";
import { apiRequest, invalidatePath } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDueDate, formatTime, isOverdue, localToday } from "@/lib/dates";
import Avatar from "@/components/Avatar";
import type { Task, Job, Employee } from "@shared/schema";
import { CheckIcon, RotateCcwIcon, RepeatIcon, BellIcon } from "lucide-react";

/**
 * One line of the task list. The checkbox is the primary action — on a phone,
 * in a truck, ticking something off should be one tap and nothing else.
 */
export default function TaskRow({
  task,
  job,
  assignee,
  onOpen,
}: {
  task: Task;
  job?: Job;
  assignee?: Employee;
  onOpen?: (task: Task) => void;
}) {
  const { toast } = useToast();
  const today = localToday();
  const done = Boolean(task.completedAt);
  const late = !done && isOverdue(task.dueDate, today);

  const refresh = () => {
    invalidatePath("/api/tasks");
    invalidatePath("/api/jobs/task-summary");
    invalidatePath("/api/activity");
  };

  const toggle = useMutation({
    mutationFn: () => apiRequest("POST", `/api/tasks/${task.id}/${done ? "reopen" : "complete"}`),
    onSuccess: async (res) => {
      refresh();
      if (done) return;
      // Tell the user the repeat was re-scheduled, rather than having a task
      // they just ticked off silently reappear on the list.
      const body = await res.json().catch(() => null);
      const next = body?.nextOccurrence;
      toast(
        next
          ? { title: "Done", description: `Next one set for ${formatDueDate(next.dueDate, today)}.` }
          : { title: "Done" },
      );
    },
    onError: () => toast({ title: "Couldn't update that task", variant: "destructive" }),
  });

  return (
    <div
      data-testid={`task-${task.id}`}
      className={`job-row flex items-start gap-3 px-4 py-3 ${done ? "opacity-55" : ""}`}
    >
      <button
        type="button"
        data-testid={`task-toggle-${task.id}`}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate()}
        className={`mt-0.5 w-6 h-6 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${
          done
            ? "bg-primary border-primary text-primary-foreground"
            : "border-muted-foreground/40 hover:border-primary hover:bg-accent"
        }`}
      >
        {done ? <CheckIcon className="w-4 h-4" /> : null}
      </button>

      <button
        type="button"
        onClick={() => onOpen?.(task)}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
            {task.title}
          </span>
          {task.priority === "urgent" && !done && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-destructive/10 text-destructive border border-destructive/25">
              Urgent
            </span>
          )}
          {task.repeatRule && <RepeatIcon className="w-3 h-3 text-muted-foreground" aria-label="Repeats" />}
          {task.remindAt && !task.reminderSentAt && (
            <BellIcon className="w-3 h-3 text-muted-foreground" aria-label="Reminder set" />
          )}
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
          {job && (
            <span className="font-mono font-bold text-primary">{job.jobNumber}</span>
          )}
          {job && <span className="text-muted-foreground truncate max-w-[18rem]">{job.jobName}</span>}
          {task.dueDate && (
            <span className={late ? "font-semibold text-destructive" : "text-muted-foreground"}>
              {late ? "Late · " : ""}
              {formatDueDate(task.dueDate, today)}
              {task.dueTime ? ` · ${formatTime(task.dueTime)}` : ""}
            </span>
          )}
        </div>
      </button>

      <div className="flex items-center gap-2 flex-shrink-0">
        {assignee ? (
          <Avatar employee={assignee} className="w-7 h-7" textClassName="text-[10px]" />
        ) : null}
        {done && (
          <RotateCcwIcon className="w-3.5 h-3.5 text-muted-foreground/50" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
