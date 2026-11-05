CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` blob NOT NULL,
	`data` blob NOT NULL,
	`position` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_user_idx` ON `agents` (`user_id`);