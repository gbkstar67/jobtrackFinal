import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertEmployeeSchema, type Employee, type InsertEmployee, type Job } from "@shared/schema";
import { z } from "zod";
import {
  PlusIcon,
  PhoneIcon,
  MailIcon,
  Trash2Icon,
  PencilIcon,
  BriefcaseIcon,
  UsersIcon,
} from "lucide-react";

const formSchema = insertEmployeeSchema.extend({
  name: z.string().min(1, "Name is required"),
});

type FormData = z.infer<typeof formSchema>;

export default function TeamPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: employees = [], isLoading } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      role: "",
      phone: "",
      email: "",
      color: AVATAR_COLORS[0],
      active: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertEmployee) => apiRequest("POST", "/api/employees", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setDialogOpen(false);
      setEditingId(null);
      form.reset({ name: "", role: "", phone: "", email: "", color: AVATAR_COLORS[(employees.length + 1) % AVATAR_COLORS.length], active: true });
      toast({ title: "Team member added" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<InsertEmployee> }) =>
      apiRequest("PATCH", `/api/employees/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setDialogOpen(false);
      setEditingId(null);
      form.reset();
      toast({ title: "Team member updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/employees/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Team member removed" });
    },
  });

  const openCreate = () => {
    setEditingId(null);
    form.reset({
      name: "",
      role: "",
      phone: "",
      email: "",
      color: AVATAR_COLORS[employees.length % AVATAR_COLORS.length],
      active: true,
    });
    setDialogOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingId(emp.id);
    form.reset({
      name: emp.name,
      role: emp.role ?? "",
      phone: emp.phone ?? "",
      email: emp.email ?? "",
      color: emp.color,
      active: emp.active,
    });
    setDialogOpen(true);
  };

  const onSubmit = (data: FormData) => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data as InsertEmployee);
    }
  };

  const getJobCount = (empId: number) =>
    jobs.filter((j) => j.assignedTo === empId).length;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-foreground uppercase tracking-tight">Team</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {employees.filter((e) => e.active).length} active members
          </p>
        </div>
        <Button
          data-testid="button-add-employee"
          onClick={openCreate}
          className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-2 tracking-wide"
        >
          <PlusIcon className="w-4 h-4" />
          Add Member
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 bg-card border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <UsersIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-muted-foreground font-medium mb-4">
            No team members yet. Add your crew to start assigning jobs.
          </p>
          <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 font-bold tracking-wide">
            <PlusIcon className="w-4 h-4" /> Add First Member
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {employees.map((emp) => {
            const activeJobs = getJobCount(emp.id);
            return (
              <div
                key={emp.id}
                data-testid={`card-employee-${emp.id}`}
                className={`bg-card border border-border rounded-lg p-5 relative ${!emp.active ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-10 h-10 rounded-full text-sm font-bold flex items-center justify-center text-white ${emp.color}`}
                    >
                      {getInitials(emp.name)}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{emp.name}</p>
                      {emp.role && (
                        <p className="text-xs text-muted-foreground">{emp.role}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      data-testid={`button-edit-employee-${emp.id}`}
                      onClick={() => openEdit(emp)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          data-testid={`button-delete-employee-${emp.id}`}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2Icon className="w-3.5 h-3.5" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-card border-border text-foreground">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {emp.name}?</AlertDialogTitle>
                          <AlertDialogDescription className="text-muted-foreground">
                            This will remove them from the team. Jobs assigned to them will become unassigned.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-border text-foreground hover:bg-accent">Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(emp.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {emp.phone && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <PhoneIcon className="w-3 h-3" />
                      <a href={`tel:${emp.phone}`} className="hover:text-primary">{emp.phone}</a>
                    </div>
                  )}
                  {emp.email && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MailIcon className="w-3 h-3" />
                      <a href={`mailto:${emp.email}`} className="hover:text-primary truncate">{emp.email}</a>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                    <BriefcaseIcon className="w-3 h-3" />
                    {activeJobs} active job{activeJobs !== 1 ? "s" : ""}
                  </div>
                </div>
                {!emp.active && (
                  <span className="absolute top-2 right-2 text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
                    Inactive
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold">
              {editingId ? "Edit Team Member" : "Add Team Member"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-2">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-foreground">Name *</FormLabel>
                  <FormControl>
                    <Input data-testid="input-emp-name" placeholder="Full name" className="bg-background border-border text-foreground placeholder:text-muted-foreground" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-foreground">Role / Title</FormLabel>
                  <FormControl>
                    <Input data-testid="input-emp-role" placeholder="e.g. Foreman, Electrician..." className="bg-background border-border text-foreground placeholder:text-muted-foreground" {...field} value={field.value ?? ""} />
                  </FormControl>
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-foreground">Phone</FormLabel>
                    <FormControl>
                      <Input data-testid="input-emp-phone" placeholder="(555) 000-0000" className="bg-background border-border text-foreground placeholder:text-muted-foreground" {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-foreground">Email</FormLabel>
                    <FormControl>
                      <Input data-testid="input-emp-email" placeholder="email@example.com" className="bg-background border-border text-foreground placeholder:text-muted-foreground" {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )} />
              </div>

              {/* Color picker */}
              <FormField control={form.control} name="color" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-foreground">Avatar Color</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      {AVATAR_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => field.onChange(c)}
                          className={`w-8 h-8 rounded-full ${c} transition-all ${
                            field.value === c
                              ? "ring-2 ring-primary ring-offset-2 ring-offset-card scale-110"
                              : "opacity-60 hover:opacity-100"
                          }`}
                        />
                      ))}
                    </div>
                  </FormControl>
                </FormItem>
              )} />

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} className="text-muted-foreground hover:text-foreground">
                  Cancel
                </Button>
                <Button type="submit" data-testid="button-submit-employee" disabled={createMutation.isPending || updateMutation.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-wide">
                  {editingId ? "Save Changes" : "Add Member"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
