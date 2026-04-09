import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertJobSchema, insertEmployeeSchema, insertActivitySchema } from "@shared/schema";

export async function registerRoutes(httpServer: Server, app: Express) {
  // ═══════════════════ EMPLOYEES ═══════════════════
  app.get("/api/employees", (_req, res) => {
    res.json(storage.getAllEmployees());
  });

  app.get("/api/employees/:id", (req, res) => {
    const emp = storage.getEmployee(parseInt(req.params.id, 10));
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  });

  app.post("/api/employees", (req, res) => {
    const result = insertEmployeeSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    const emp = storage.createEmployee(result.data);
    res.status(201).json(emp);
  });

  app.patch("/api/employees/:id", (req, res) => {
    const result = insertEmployeeSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    const emp = storage.updateEmployee(parseInt(req.params.id, 10), result.data);
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  });

  app.delete("/api/employees/:id", (req, res) => {
    const deleted = storage.deleteEmployee(parseInt(req.params.id, 10));
    if (!deleted) return res.status(404).json({ message: "Employee not found" });
    res.status(204).end();
  });

  // ═══════════════════ JOBS ═══════════════════
  app.get("/api/jobs", (_req, res) => {
    res.json(storage.getAllJobs());
  });

  app.get("/api/jobs/next-number", (_req, res) => {
    res.json({ jobNumber: storage.getNextJobNumber() });
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = storage.getJob(parseInt(req.params.id, 10));
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json(job);
  });

  app.post("/api/jobs", (req, res) => {
    const result = insertJobSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });
    const job = storage.createJob(result.data);

    // Log activity
    const emp = job.createdBy ? storage.getEmployee(job.createdBy) : null;
    storage.logActivity({
      jobId: job.id,
      employeeId: job.createdBy ?? null,
      action: "created",
      details: `${emp?.name ?? "Someone"} created job ${job.jobNumber}`,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json(job);
  });

  app.patch("/api/jobs/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const oldJob = storage.getJob(id);
    if (!oldJob) return res.status(404).json({ message: "Job not found" });

    const result = insertJobSchema.partial().safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Invalid data", errors: result.error.flatten() });

    const updatedJob = storage.updateJob(id, result.data);
    if (!updatedJob) return res.status(404).json({ message: "Job not found" });

    // Log changes
    const changedBy = req.body._changedBy ? storage.getEmployee(req.body._changedBy) : null;
    const actor = changedBy?.name ?? "Someone";

    if (result.data.status && result.data.status !== oldJob.status) {
      storage.logActivity({
        jobId: id,
        employeeId: changedBy?.id ?? null,
        action: "status_changed",
        details: `${actor} changed status from ${oldJob.status} to ${result.data.status}`,
        timestamp: new Date().toISOString(),
      });
    }
    if (result.data.assignedTo !== undefined && result.data.assignedTo !== oldJob.assignedTo) {
      const assignee = result.data.assignedTo ? storage.getEmployee(result.data.assignedTo) : null;
      storage.logActivity({
        jobId: id,
        employeeId: changedBy?.id ?? null,
        action: "assigned",
        details: assignee ? `${actor} assigned job to ${assignee.name}` : `${actor} unassigned job`,
        timestamp: new Date().toISOString(),
      });
    }
    // General update log for other changes
    const skipKeys = ["status", "assignedTo", "_changedBy"];
    const otherChanges = Object.keys(result.data).filter((k) => !skipKeys.includes(k));
    if (otherChanges.length > 0) {
      storage.logActivity({
        jobId: id,
        employeeId: changedBy?.id ?? null,
        action: "updated",
        details: `${actor} updated ${otherChanges.join(", ")}`,
        timestamp: new Date().toISOString(),
      });
    }

    res.json(updatedJob);
  });

  app.delete("/api/jobs/:id", (req, res) => {
    const job = storage.getJob(parseInt(req.params.id, 10));
    const deleted = storage.deleteJob(parseInt(req.params.id, 10));
    if (!deleted) return res.status(404).json({ message: "Job not found" });

    if (job) {
      storage.logActivity({
        jobId: job.id,
        employeeId: null,
        action: "deleted",
        details: `Job ${job.jobNumber} (${job.jobName}) was deleted`,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(204).end();
  });

  // ═══════════════════ ACTIVITY LOG ═══════════════════
  app.get("/api/activity", (req, res) => {
    const jobId = req.query.jobId ? parseInt(req.query.jobId as string, 10) : undefined;
    res.json(storage.getActivities(jobId));
  });

  return httpServer;
}
