import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import AppShell from "@/components/AppShell";
import { AVATAR_COLORS, getInitials } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertJobSchema, type Job, type InsertJob, type Employee } from "@shared/schema";
import { z } from "zod";
import {
  PlusIcon,
  SearchIcon,
  BriefcaseIcon,
  CheckCircleIcon,
  ClockIcon,
  PauseCircleIcon,
  ChevronRightIcon,
  HardHatIcon,
  CalendarIcon,
  UserIcon,
} from "lucide-react";

const formSchema = insertJobSchema.extend({
  clientName: z.string().min(1, "Client name is required"),
  jobName: z.string().min(1, "Job name is required"),
});

type FormData = z.infer<typeof formSchema>;

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof ClockIcon }> = {
  pending: { label: "Pending", color: "status-pending", icon: ClockIcon },
  in_progress: { label: "In Progress", color: "status-in_progress", icon: BriefcaseIcon },
  completed: { label: "Completed", color: "status-completed", icon: CheckCircleIcon },
  on_hold: { label: "On Hold", color: "status-on_hold", icon: PauseCircleIcon },
};

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: jobs = [], isLoading } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const activeEmployees = employees.filter((e) => e.active);

  const empMap = new Map(employees.map((e) => [e.id, e]));

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      jobName: "",
      clientName: "",
      clientPhone: "",
      clientEmail: "",
      clientAddress: "",
      status: "pending",
      assignedTo: null,
      createdBy: null,
      startDate: "",
      dueDate: "",
      notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertJob) => apiRequest("POST", "/api/jobs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Job created", description: "New job added successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create job.", variant: "destructive" });
    },
  });

  const onSubmit = (data: FormData) => {
    // createdBy is deliberately not sent: the server reads the actor from the
    // session, so a client can't file a job under someone else's name.
    const payload: any = { ...data };
    if (payload.assignedTo === null || payload.assignedTo === "none") payload.assignedTo = null;
    else payload.assignedTo = parseInt(payload.assignedTo as any, 10);
    createMutation.mutate(payload as InsertJob);
  };

  const filteredJobs = jobs.filter((job) => {
    const matchesSearch =
      search === "" ||
      job.jobName.toLowerCase().includes(search.toLowerCase()) ||
      job.jobNumber.toLowerCase().includes(search.toLowerCase()) ||
      job.clientName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || job.status === statusFilter;
    const matchesAssignee =
      assigneeFilter === "all" ||
      (assigneeFilter === "unassigned" ? !job.assignedTo : String(job.assignedTo) === assigneeFilter);
    return matchesSearch && matchesStatus && matchesAssignee;
  });

  const stats = {
    total: jobs.length,
    in_progress: jobs.filter((j) => j.status === "in_progress").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    pending: jobs.filter((j) => j.status === "pending").length,
  };

  return (
    <AppShell>
      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Jobs", value: stats.total, icon: HardHatIcon, accent: "text-foreground" },
          { label: "In Progress", value: stats.in_progress, icon: BriefcaseIcon, accent: "text-orange-400" },
          { label: "Completed", value: stats.completed, icon: CheckCircleIcon, accent: "text-green-400" },
          { label: "Pending", value: stats.pending, icon: ClockIcon, accent: "text-slate-400" },
        ].map((stat) => (
          <div key={stat.label} data-testid={`stat-${stat.label.toLowerCase().replace(" ", "-")}`} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{stat.label}</span>
              <stat.icon className={`w-4 h-4 ${stat.accent}`} />
            </div>
            <p className={`font-display text-2xl font-bold ${stat.accent}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Search & Filter Row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            data-testid="input-search"
            placeholder="Search by job number, name, or client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger data-testid="select-status-filter" className="w-full sm:w-40 bg-card border-border text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border text-foreground">
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
          </SelectContent>
        </Select>
        {activeEmployees.length > 0 && (
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger data-testid="select-assignee-filter" className="w-full sm:w-44 bg-card border-border text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground">
              <SelectItem value="all">All Assignees</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {activeEmployees.map((emp) => (
                <SelectItem key={emp.id} value={String(emp.id)}>
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white ${emp.color}`}>
                      {getInitials(emp.name)}
                    </span>
                    {emp.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-job" className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold gap-2">
              <PlusIcon className="w-4 h-4" />
              New Job
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-lg font-bold">Add New Job</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-2">
                <FormField control={form.control} name="jobName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-foreground">Job Name *</FormLabel>
                    <FormControl>
                      <Input data-testid="input-job-name" placeholder="e.g. Kitchen remodel, Foundation pour..." className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="clientName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-foreground">Client Name *</FormLabel>
                    <FormControl>
                      <Input data-testid="input-client-name" placeholder="Full name or company" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="clientPhone" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-foreground">Phone</FormLabel>
                      <FormControl>
                        <Input data-testid="input-client-phone" placeholder="(555) 000-0000" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clientEmail" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-foreground">Email</FormLabel>
                      <FormControl>
                        <Input data-testid="input-client-email" placeholder="email@example.com" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="clientAddress" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-foreground">Job Site Address</FormLabel>
                    <FormControl>
                      <Input data-testid="input-client-address" placeholder="Street address" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="status" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-foreground">Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-status" className="bg-secondary border-border text-foreground">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
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

                  {activeEmployees.length > 0 && (
                    <FormField control={form.control} name="assignedTo" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-foreground">Assign To</FormLabel>
                        <Select
                          onValueChange={(val) => field.onChange(val === "none" ? null : parseInt(val, 10))}
                          value={field.value ? String(field.value) : "none"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-assign" className="bg-secondary border-border text-foreground">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="bg-card border-border text-foreground">
                            <SelectItem value="none">Unassigned</SelectItem>
                            {activeEmployees.map((emp) => (
                              <SelectItem key={emp.id} value={String(emp.id)}>
                                <div className="flex items-center gap-2">
                                  <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white ${emp.color}`}>
                                    {getInitials(emp.name)}
                                  </span>
                                  {emp.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="startDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-foreground">Start Date</FormLabel>
                      <FormControl>
                        <Input data-testid="input-start-date" type="date" className="bg-secondary border-border text-foreground" {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="dueDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-foreground">Due Date</FormLabel>
                      <FormControl>
                        <Input data-testid="input-due-date" type="date" className="bg-secondary border-border text-foreground" {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-foreground">Notes</FormLabel>
                    <FormControl>
                      <Textarea data-testid="input-notes" placeholder="Scope of work, special instructions..." className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none" rows={3} {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )} />

                <div className="flex justify-end gap-3 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} className="text-muted-foreground hover:text-foreground">Cancel</Button>
                  <Button type="submit" data-testid="button-submit-job" disabled={createMutation.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
                    {createMutation.isPending ? "Creating..." : "Create Job"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Jobs Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-display font-bold text-sm text-foreground uppercase tracking-wide">Jobs</h2>
          <span className="text-xs text-muted-foreground">{filteredJobs.length} of {jobs.length}</span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center space-y-2">
            {[1, 2, 3].map((i) => (<div key={i} className="h-14 bg-secondary/50 rounded animate-pulse" />))}
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="p-12 text-center">
            <HardHatIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              {jobs.length === 0 ? "No jobs yet. Add your first job." : "No jobs match your filters."}
            </p>
            {jobs.length === 0 && (
              <Button onClick={() => setDialogOpen(true)} className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
                <PlusIcon className="w-4 h-4" /> Add First Job
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop header */}
            <div className="hidden sm:grid grid-cols-[120px_1fr_1fr_100px_120px_100px_28px] gap-3 px-4 py-2.5 border-b border-border bg-secondary/30">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Job #</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Job Name</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Client</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Due Date</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assigned</span>
              <span className="sr-only">Go</span>
            </div>

            <div className="divide-y divide-border">
              {filteredJobs.map((job) => {
                const statusCfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending;
                const StatusIcon = statusCfg.icon;
                const assignee = job.assignedTo ? empMap.get(job.assignedTo) : null;
                return (
                  <button key={job.id} data-testid={`row-job-${job.id}`} onClick={() => navigate(`/job/${job.id}`)} className="job-row w-full text-left">
                    {/* Desktop */}
                    <div className="hidden sm:grid grid-cols-[120px_1fr_1fr_100px_120px_100px_28px] gap-3 px-4 py-3.5 items-center">
                      <span data-testid={`text-job-number-${job.id}`} className="font-mono text-sm font-semibold text-primary">{job.jobNumber}</span>
                      <span className="text-sm font-medium text-foreground truncate">{job.jobName}</span>
                      <div className="flex items-center gap-2 min-w-0">
                        <UserIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm text-muted-foreground truncate">{job.clientName}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {job.dueDate ? (
                          <>
                            <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                              {new Date(job.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </>
                        ) : <span className="text-xs text-muted-foreground/40">—</span>}
                      </div>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full w-fit ${statusCfg.color}`}>
                        <StatusIcon className="w-3 h-3" />
                        {statusCfg.label}
                      </span>
                      <div>
                        {assignee ? (
                          <span className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${assignee.color}`} title={assignee.name}>
                            {getInitials(assignee.name)}
                          </span>
                        ) : <span className="text-xs text-muted-foreground/40">—</span>}
                      </div>
                      <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />
                    </div>

                    {/* Mobile */}
                    <div className="sm:hidden px-4 py-3.5">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0">
                          <span className="font-mono text-xs font-bold text-primary block">{job.jobNumber}</span>
                          <span className="text-sm font-medium text-foreground">{job.jobName}</span>
                        </div>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${statusCfg.color}`}>
                          {statusCfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><UserIcon className="w-3 h-3" />{job.clientName}</span>
                        {assignee && (
                          <span className="flex items-center gap-1">
                            <span className={`w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center text-white ${assignee.color}`}>{getInitials(assignee.name)}</span>
                            {assignee.name.split(" ")[0]}
                          </span>
                        )}
                        {job.dueDate && (
                          <span className="flex items-center gap-1">
                            <CalendarIcon className="w-3 h-3" />
                            {new Date(job.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
