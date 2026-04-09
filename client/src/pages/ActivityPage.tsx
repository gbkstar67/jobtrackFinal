import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import AppShell from "@/components/AppShell";
import { getInitials } from "@/components/AppShell";
import type { Activity, Employee, Job } from "@shared/schema";
import {
  PlusCircleIcon,
  EditIcon,
  ArrowRightLeftIcon,
  UserPlusIcon,
  Trash2Icon,
  ActivityIcon,
} from "lucide-react";

const ACTION_ICONS: Record<string, typeof PlusCircleIcon> = {
  created: PlusCircleIcon,
  updated: EditIcon,
  status_changed: ArrowRightLeftIcon,
  assigned: UserPlusIcon,
  deleted: Trash2Icon,
};

const ACTION_COLORS: Record<string, string> = {
  created: "text-green-400",
  updated: "text-blue-400",
  status_changed: "text-orange-400",
  assigned: "text-purple-400",
  deleted: "text-red-400",
};

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ActivityPage() {
  const [, navigate] = useLocation();

  const { data: activities = [], isLoading } = useQuery<Activity[]>({ queryKey: ["/api/activity"] });
  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const empMap = new Map(employees.map((e) => [e.id, e]));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  return (
    <AppShell>
      <div>
        <h1 className="font-display text-xl font-bold text-foreground">Activity Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track every change across all jobs
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-secondary/50 rounded animate-pulse" />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="p-12 text-center">
            <ActivityIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              No activity yet. Create a job to get started.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {activities.map((act) => {
              const Icon = ACTION_ICONS[act.action] || EditIcon;
              const color = ACTION_COLORS[act.action] || "text-muted-foreground";
              const emp = act.employeeId ? empMap.get(act.employeeId) : null;
              const job = jobMap.get(act.jobId);

              return (
                <div key={act.id} className="px-4 py-3.5 flex items-start gap-3">
                  <div className={`mt-0.5 ${color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                      {act.details}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      {job && act.action !== "deleted" && (
                        <button
                          onClick={() => navigate(`/job/${job.id}`)}
                          className="text-xs text-primary hover:underline font-mono font-semibold"
                        >
                          {job.jobNumber}
                        </button>
                      )}
                      <span className="text-xs text-muted-foreground">{timeAgo(act.timestamp)}</span>
                    </div>
                  </div>
                  {emp && (
                    <span
                      className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center text-white flex-shrink-0 ${emp.color}`}
                      title={emp.name}
                    >
                      {getInitials(emp.name)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
