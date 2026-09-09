CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`address` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reports_updated_at_idx` ON `reports` (`updated_at`);