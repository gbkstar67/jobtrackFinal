import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import AppShell from "@/components/AppShell";
import { getInitials } from "@/components/AppShell";
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
import {
  insertJobSchema, BID_BY, BILLING_TYPE,
  type Job, type InsertJob, type Employee, type BidBy, type BillingType,
} from "@shared/schema";
import CodePicker, { CodeBadge } from "@/components/CodePicker";
import { FadeBar } from "@/components/Brand";
import { z } from "zod";
import {
  PlusIcon,
  SearchIcon,
  ChevronRightIcon,
  HardHatIcon,
  UserIcon,
} from "lucide-react";

const formSchema = insertJobSchema.extend({
  clientName: z.string().min(1, "Client name is required"),
  jobName: z.string().min(1, "Job name is required"),
});

type FormData = z.infer<typeof formSchema>;

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
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
      assignedTo: null,
      startDate: "",
      bidBy: null,
      billingType: null,
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

  // Job number, job name and client name all stay searchable, so whichever one
  // someone happens to remember will find the row.
  const filteredJobs = jobs.filter((job) => {
    const q = search.toLowerCase();
    const matchesSearch =
      search === "" ||
      job.jobName.toLowerCase().includes(q) ||
      job.jobNumber.toLowerCase().includes(q) ||
      job.clientName.toLowerCase().includes(q);
    const matchesAssignee =
      assigneeFilter === "all" ||
      (assigneeFilter === "unassigned" ? !job.assignedTo : String(job.assignedTo) === assigneeFilter);
    return matchesSearch && matchesAssignee;
  });

  return (
    <AppShell>
      {/* Search & Filter Row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            data-testid="input-search"
            placeholder="Search by job number, name, or client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card border-border text-foreground placeholder:text-muted-foreground shadow-sm"
          />
        </div>
        {activeEmployees.length > 0 && (
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger data-testid="select-assignee-filter" className="w-full sm:w-44 bg-card border-border text-foreground shadow-sm">
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
            <Button data-testid="button-new-job" className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-2 shadow-sm tracking-wide">
              <PlusIcon className="w-4 h-4" />
              New Job
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-widest">Add New Job</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-2">
                <FormField control={form.control} name="jobName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="label-caps">Job Name *</FormLabel>
                    <FormControl>
                      <Input data-testid="input-job-name" placeholder="e.g. Kitchen remodel, Foundation pour..." className="bg-background border-border text-foreground placeholder:text-muted-foreground" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="clientName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="label-caps">Client Name *</FormLabel>
                    <FormControl>
                      <Input data-testid="input-client-name" placeholder="Full name or company" className="bg-background border-border text-foreground placeholder:text-muted-foreground" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="clientPhone" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="label-caps">Phone</FormLabel>
                      <FormControl>
                        <Input data-testid="input-client-phone" placeholder="(555) 000-0000" className="bg-background border-border text-foreground placeholder:text-muted-foreground" {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="clientEmail" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="label-caps">Email</FormLabel>
                      <FormControl>
                        <Input data-testid="input-client-email" placeholder="email@example.com" className="bg-background border-border text-foreground placeholder:text-muted-foreground" {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="clientAddress" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="label-caps">Job Site Address</FormLabel>
                    <FormControl>
                      <Input data-testid="input-client-address" placeholder="Street address" className="bg-background border-border text-foreground placeholder:text-muted-foreground" {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="startDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="label-caps">Start Date</FormLabel>
                      <FormControl>
                        <Input data-testid="input-start-date" type="date" className="bg-background border-border text-foreground" {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )} />

                  {activeEmployees.length > 0 && (
                    <FormField control={form.control} name="assignedTo" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="label-caps">Assign To</FormLabel>
                        <Select
                          onValueChange={(val) => field.onChange(val === "none" ? null : parseInt(val, 10))}
                          value={field.value ? String(field.value) : "none"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-assign" className="bg-background border-border text-foreground">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField control={form.control} name="bidBy" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="label-caps">Who bid this job?</FormLabel>
                      <CodePicker<BidBy>
                        testId="picker-bid-by"
                        value={field.value as BidBy | null}
                        onChange={field.onChange}
                        options={[
                          { code: "HT", label: BID_BY.HT },
                          { code: "DV", label: BID_BY.DV },
                        ]}
                      />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="billingType" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="label-caps">Contract or Time &amp; Material?</FormLabel>
                      <CodePicker<BillingType>
                        testId="picker-billing-type"
                        value={field.value as BillingType | null}
                        onChange={field.onChange}
                        options={[
                          { code: "CO", label: BILLING_TYPE.CO },
                          { code: "TM", label: BILLING_TYPE.TM },
                        ]}
                      />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="label-caps">Notes</FormLabel>
                    <FormControl>
                      <Textarea data-testid="input-notes" placeholder="Scope of work, special instructions..." className="bg-background border-border text-foreground placeholder:text-muted-foreground resize-none" rows={3} {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )} />

                <div className="flex justify-end gap-3 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} className="text-muted-foreground hover:text-foreground">Cancel</Button>
                  <Button type="submit" data-testid="button-submit-job" disabled={createMutation.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-wide">
                    {createMutation.isPending ? "Creating..." : "Create Job"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Jobs Table */}
      <div className="sheet-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "hsl(var(--navy))" }}>
          <div className="flex items-center gap-3">
            <h2 className="font-display font-extrabold text-sm text-white uppercase tracking-widest">Job Log</h2>
            <FadeBar className="h-[9px] w-[46px] opacity-70" color="hsl(var(--primary-foreground))" />
          </div>
          <span className="font-mono text-xs text-white/70">
            {filteredJobs.length} / {jobs.length}
          </span>
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
              <Button onClick={() => setDialogOpen(true)} className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90 gap-2 font-bold tracking-wide">
                <PlusIcon className="w-4 h-4" /> Add First Job
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop header */}
            <div className="hidden sm:grid grid-cols-[140px_1fr_1fr_90px_100px_28px] gap-3 px-4 py-2.5 border-b border-border bg-secondary/60">
              <span className="label-caps">Job #</span>
              <span className="label-caps">Job Name</span>
              <span className="label-caps">Client</span>
              <span className="label-caps">Bid / Type</span>
              <span className="label-caps">Assigned</span>
              <span className="sr-only">Go</span>
            </div>

            <div className="divide-y divide-border">
              {filteredJobs.map((job) => {
                const assignee = job.assignedTo ? empMap.get(job.assignedTo) : null;
                return (
                  <button key={job.id} data-testid={`row-job-${job.id}`} onClick={() => navigate(`/job/${job.id}`)} className="job-row w-full text-left">
                    {/* Desktop */}
                    <div className="hidden sm:grid grid-cols-[140px_1fr_1fr_90px_100px_28px] gap-3 px-4 py-3.5 items-center">
                      <span data-testid={`text-job-number-${job.id}`} className="font-mono text-sm font-bold text-primary tracking-tight">{job.jobNumber}</span>
                      <span className="text-sm font-medium text-foreground truncate">{job.jobName}</span>
                      <div className="flex items-center gap-2 min-w-0">
                        <UserIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm text-muted-foreground truncate">{job.clientName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {job.bidBy ? (
                          <CodeBadge code={job.bidBy} title={BID_BY[job.bidBy as BidBy] ?? undefined} />
                        ) : <span className="text-xs text-muted-foreground/40">—</span>}
                        {job.billingType ? (
                          <CodeBadge code={job.billingType} title={BILLING_TYPE[job.billingType as BillingType] ?? undefined} />
                        ) : null}
                      </div>
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
                          <span className="font-mono text-xs font-bold text-primary block tracking-tight">{job.jobNumber}</span>
                          <span className="label-caps">{job.jobName}</span>
                        </div>
                        {assignee && (
                          <span className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center text-white flex-shrink-0 ${assignee.color}`} title={assignee.name}>
                            {getInitials(assignee.name)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <UserIcon className="w-3 h-3" />{job.clientName}
                        </span>
                        {job.bidBy && <CodeBadge code={job.bidBy} title={BID_BY[job.bidBy as BidBy] ?? undefined} />}
                        {job.billingType && <CodeBadge code={job.billingType} title={BILLING_TYPE[job.billingType as BillingType] ?? undefined} />}
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
