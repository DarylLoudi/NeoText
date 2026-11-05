CREATE TABLE `quotas` (
	`user_id` text PRIMARY KEY NOT NULL,
	`daily_usd` real,
	`monthly_usd` real,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `usage_events` ADD `shared` integer DEFAULT false NOT NULL;