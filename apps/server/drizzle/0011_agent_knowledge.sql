CREATE TABLE `agent_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`seq` integer NOT NULL,
	`page` integer,
	`text` blob NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `agent_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_chunks_agent_idx` ON `agent_chunks` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_chunks_file_idx` ON `agent_chunks` (`file_id`);--> statement-breakpoint
CREATE TABLE `agent_files` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` blob NOT NULL,
	`size` integer NOT NULL,
	`pages` integer,
	`chunks` integer NOT NULL,
	`text_bytes` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_files_agent_idx` ON `agent_files` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_files_user_idx` ON `agent_files` (`user_id`);