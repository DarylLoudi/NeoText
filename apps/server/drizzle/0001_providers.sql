CREATE TABLE `model_cache` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`fetched_at` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`category` text DEFAULT 'llm' NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key` blob,
	`key_hint` text,
	`headers` blob,
	`manual_models` text,
	`enabled` integer DEFAULT true NOT NULL,
	`position` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `providers_owner_idx` ON `providers` (`owner_user_id`);