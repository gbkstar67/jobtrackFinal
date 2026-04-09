CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_number` text NOT NULL,
	`job_name` text NOT NULL,
	`client_name` text NOT NULL,
	`client_phone` text,
	`client_email` text,
	`client_address` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`start_date` text,
	`due_date` text,
	`completed_date` text,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_job_number_unique` ON `jobs` (`job_number`);