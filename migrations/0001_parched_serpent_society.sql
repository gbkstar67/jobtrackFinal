CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`employee_id` integer,
	`action` text NOT NULL,
	`details` text,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`phone` text,
	`email` text,
	`color` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `assigned_to` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `created_by` integer;