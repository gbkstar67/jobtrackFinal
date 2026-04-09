import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation, useParams } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/App";
import AppShell from "@/components/AppShell";
import { getInitials } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertJobSchema, type Job, type Employee, type Activity } from "@shared/schema";
import { z } from "zod";
import {
  ArrowLeftIcon,
  Trash2Icon,
  SaveIcon,
  PhoneIcon,
  MailIcon,
  MapPinIcon,
  CalendarIcon,
  UserIcon,
  HashIcon,
  BriefcaseIcon,
  CheckCircleIcon,
  ClockIcon,
  PauseCircleIcon,
  PlusCircleIcon,
  EditIcon,
  ArrowRightLeftIcon,
  UserPlusIcon,
  ActivityIcon,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof ClockIcon }> = {
  pending: { label: "Pending", color: "status-pending", icon: ClockIcon },
  in_progress: { label: "In Progress", color: "status-in_progress", icon: BriefcaseIcon },
  completed: { label: "Completed", color: "status-completed", icon: CheckCircleIcon },
  on_hold: { label: "On Hold", color: "status-on_hold", icon: PauseCircleIcon },
};

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

const editSchema = insertJobSchema.extend({
  clientName: z.string().min(1, "Client name is required"),
  jobName: z.string().min(1, "Job name is required"),
});

type EditData = z.infer<typeof editSchema>;

export default function JobDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { currentUser } = useCurrentUser();
  const [isEditing, setIsEditing] = useState(false);

  const id = parseInt(params.id, 10);

  const { data: job, isLoading } = useQuery<Job>({
    queryKey: ["/api/jobs", id],
    queryFn: () => apiRequest("GET", `/api/jobs/${id}`).then((r) => r.json()),
  });

  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const { data: activities = [] } = useQuery<Activity[]>({
    queryKey: ["/api/activity", id],
    queryFn: () => apiRequest("GET", `/api/activity?jobId=${id}`).then((r) => r.json()),
  });

  const activeEmployees = employees.filter((e) => e.active);
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const form = useForm<EditData>({
    resolver: zodResolver(editSchema),
    values: job
      ? {
          jobName: job.jobName,
          clientName: job.clientName,
          clientPhone: job.clientPhone ?? "",
          clientEmail: job.clientEmail ?? "",
          clientAddress: job.clientAddress ?? "",
          status: job.status,
          assignedTo: job.assignedTo ?? null,
          createdBy: job.createdBy ?? null,
          startDate: job.startDate ?? "",
          dueDate: job.dueDate ?? "",
          completedDate: job.completedDate ?? "",
          notes: job.notes ?? "",
        }
      : undefined,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<EditData> & { _changedBy?: number }) =>
      apiRequest("PATCH", `/api/jobs/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      setIsEditing(false);
      toast({ title: "Saved", description: "Job updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update job.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/jobs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      navigate("/");
      toast({ title: "Deleted", description: "Job removed." });
    },
  });

  const onSubmit = (data: EditData) => {
    const payload: any = { ...data };
    if (currentUser) payload._changedBy = currentUser.id;
    if (payload.assignedTo === "none" || payload.assignedTo === null) payload.assignedTo = null;
    else if (typeof payload.assignedTo === "string") payload.assignedTo = parseInt(payload.assignedTo, 10);
    updateMutation.mutate(payload);
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="space-y-3 max-w-4xl mx-auto">
          {[1, 2, 3].map((i) => (<div key={i} className="h-16 bg-card rounded-lg animate-pulse" />))}
        </div>
      </AppShell>
    );
  }

  if (!job) {
    return (
      <AppShell>
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-4">Job not found.</p>
          <Button onClick={() => navigate("/")} variant="ghost">Back to Dashboard</Button>
        </div>
      </AppShell>
    );
  }

  const statusCfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending;
  const StatusIcon = statusCfg.icon;
  const assignee = job.assignedTo ? empMap.get(job.assignedTo) : null;
  const creator = job.createdBy ? empMap.get(job.createdBy) : null;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4">
          <button data-testid="button-back" onClick={() => navigate("/")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeftIcon className="w-4 h-4" /> All Jobs
          </button>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button variant="ghost" onClick={() => { setIsEditing(false); form.reset(); }} className="text-muted-foreground">Cancel</Button>
                <Button data-testid="button-save" onClick={form.handleSubmit(onSubmit)} disabled={updateMutation.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 font-semibold">
                  <SaveIcon className="w-4 h-4" /> {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </>
            ) : (
              <>
                <Button data-testid="button-edit" onClick={() => setIsEditing(true)} variant="outline" className="border-border text-foreground hover:bg-accent">Edit Job</Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button data-testid="button-delete" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                      <Trash2Icon className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-border text-foreground">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this job?</AlertDialogTitle>
                      <AlertDialogDescription className="text-muted-foreground">
                        This will permanently delete {job.jobNumber} — {job.jobName}.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-border text-foreground hover:bg-accent">Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteMutation.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>

        {/* Job identity */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <HashIcon className="w-4 h-4 text-primary" />
              <span data-testid="text-job-number" className="font-mono text-sm font-bold text-primary">{job.jobNumber}</span>
            </div>
            {isEditing ? (
              <Form {...form}>
                <FormField control={form.control} name="jobName" render={({ field }) => (
                  <FormItem><FormControl>
                    <Input data-testid="input-edit-job-name" className="bg-secondary border-border text-foreground text-xl font-display font-bold h-auto py-1" {...field} />
                  </FormControl><FormMessage /></FormItem>
                )} />
              </Form>
            ) : (
              <h1 data-testid="text-job-name" className="font-display text-xl font-bold text-foreground">{job.jobName}</h1>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Assignment */}
            {isEditing ? (
              <Form {...form}>
                <FormField control={form.control} name="assignedTo" render={({ field }) => (
                  <FormItem>
                    <Select onValueChange={(val) => field.onChange(val === "none" ? null : parseInt(val, 10))} value={field.value ? String(field.value) : "none"}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-assign" className="w-40 bg-secondary border-border text-foreground">
                          <SelectValue placeholder="Assign..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-card border-border text-foreground">
                        <SelectItem value="none">Unassigned</SelectItem>
                        {activeEmployees.map((emp) => (
                          <SelectItem key={emp.id} value={String(emp.id)}>
                            <div className="flex items-center gap-2">
                              <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white ${emp.color}`}>{getInitials(emp.name)}</span>
                              {emp.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </Form>
            ) : assignee ? (
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${assignee.color}`}>{getInitials(assignee.name)}</span>
                <span className="text-muted-foreground">{assignee.name}</span>
              </div>
            ) : null}

            {/* Status */}
            {isEditing ? (
              <Form {...form}>
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-status" className="w-40 bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-card border-border text-foreground">
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="on_hold">On Hold</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </Form>
            ) : (
              <span data-testid="status-badge" className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full ${statusCfg.color}`}>
                <StatusIcon className="w-4 h-4" /> {statusCfg.label}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Client info */}
          <div className="bg-card border border-border rounded-lg p-5 space-y-4">
            <h2 className="font-display font-bold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <UserIcon className="w-4 h-4" /> Client Information
            </h2>
            {isEditing ? (
              <Form {...form}>
                <div className="space-y-3">
                  <FormField control={form.control} name="clientName" render={({ field }) => (
                    <FormItem><FormLabel className="text-xs text-muted-foreground">Name *</FormLabel><FormControl>
                      <Input data-testid="input-edit-client-name" className="bg-secondary border-border text-foreground h-8 text-sm" {...field} />
                    </FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="clientPhone" render={({ field }) => (
                    <FormItem><FormLabel className="text-xs text-muted-foreground">Phone</FormLabel><FormControl>
                      <Input data-testid="input-edit-client-phone" className="bg-secondary border-border text-foreground h-8 text-sm" {...field} value={field.value ?? ""} />
                    </FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="clientEmail" render={({ field }) => (
                    <FormItem><FormLabel className="text-xs text-muted-foreground">Email</FormLabel><FormControl>
                      <Input data-testid="input-edit-client-email" className="bg-secondary border-border text-foreground h-8 text-sm" {...field} value={field.value ?? ""} />
                    </FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="clientAddress" render={({ field }) => (
                    <FormItem><FormLabel className="text-xs text-muted-foreground">Address</FormLabel><FormControl>
                      <Input data-testid="input-edit-client-address" className="bg-secondary border-border text-foreground h-8 text-sm" {...field} value={field.value ?? ""} />
                    </FormControl></FormItem>
                  )} />
                </div>
              </Form>
            ) : (
              <div className="space-y-3">
                <div><p className="text-xs text-muted-foreground mb-0.5">Name</p><p className="text-sm font-medium text-foreground">{job.clientName}</p></div>
                {job.clientPhone && (<div className="flex items-center gap-2"><PhoneIcon className="w-3.5 h-3.5 text-muted-foreground" /><a href={`tel:${job.clientPhone}`} className="text-sm text-primary hover:underline">{job.clientPhone}</a></div>)}
                {job.clientEmail && (<div className="flex items-center gap-2"><MailIcon className="w-3.5 h-3.5 text-muted-foreground" /><a href={`mailto:${job.clientEmail}`} className="text-sm text-primary hover:underline truncate">{job.clientEmail}</a></div>)}
                {job.clientAddress && (<div className="flex items-start gap-2"><MapPinIcon className="w-3.5 h-3.5 text-muted-foreground mt-0.5" /><p className="text-sm text-muted-foreground">{job.clientAddress}</p></div>)}
                {!job.clientPhone && !job.clientEmail && !job.clientAddress && (<p className="text-sm text-muted-foreground/50">No contact details on file.</p>)}
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="bg-card border border-border rounded-lg p-5 space-y-4">
            <h2 className="font-display font-bold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <CalendarIcon className="w-4 h-4" /> Schedule
            </h2>
            {isEditing ? (
              <Form {...form}>
                <div className="space-y-3">
                  {(["startDate", "dueDate", "completedDate"] as const).map((f) => (
                    <FormField key={f} control={form.control} name={f} render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground capitalize">
                          {f === "startDate" ? "Start Date" : f === "dueDate" ? "Due Date" : "Completed Date"}
                        </FormLabel>
                        <FormControl>
                          <Input type="date" className="bg-secondary border-border text-foreground h-8 text-sm" {...field} value={field.value ?? ""} />
                        </FormControl>
                      </FormItem>
                    )} />
                  ))}
                </div>
              </Form>
            ) : (
              <div className="space-y-3">
                {[{ label: "Start Date", value: job.startDate }, { label: "Due Date", value: job.dueDate }, { label: "Completed", value: job.completedDate }].map(({ label, value }) => (
                  <div key={label}><p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                    <p className="text-sm font-medium text-foreground">
                      {value ? new Date(value + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" }) : <span className="text-muted-foreground/40">—</span>}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <h2 className="font-display font-bold text-sm text-muted-foreground uppercase tracking-wide">Notes / Scope of Work</h2>
          {isEditing ? (
            <Form {...form}>
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem><FormControl>
                  <Textarea data-testid="input-edit-notes" placeholder="Scope of work, materials, instructions..." className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none" rows={5} {...field} value={field.value ?? ""} />
                </FormControl></FormItem>
              )} />
            </Form>
          ) : (
            <p data-testid="text-notes" className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {job.notes || <span className="text-muted-foreground/40">No notes added.</span>}
            </p>
          )}
        </div>

        {/* Activity feed for this job */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="font-display font-bold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <ActivityIcon className="w-4 h-4" /> Activity
            </h2>
          </div>
          {activities.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground/50">No activity recorded.</p>
          ) : (
            <div className="divide-y divide-border">
              {activities.map((act) => {
                const Icon = ACTION_ICONS[act.action] || EditIcon;
                const color = ACTION_COLORS[act.action] || "text-muted-foreground";
                const emp = act.employeeId ? empMap.get(act.employeeId) : null;
                return (
                  <div key={act.id} className="px-5 py-3 flex items-start gap-3">
                    <div className={`mt-0.5 ${color}`}><Icon className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{act.details}</p>
                      <span className="text-xs text-muted-foreground">{timeAgo(act.timestamp)}</span>
                    </div>
                    {emp && (
                      <span className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center text-white flex-shrink-0 ${emp.color}`} title={emp.name}>
                        {getInitials(emp.name)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground/50 pb-4">
          <span>Created {new Date(job.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
          {creator && (<><span>·</span><span>by {creator.name}</span></>)}
        </div>
      </div>
    </AppShell>
  );
}
