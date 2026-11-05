CREATE TABLE `favicon_cache` (
	`host` text PRIMARY KEY NOT NULL,
	`ok` integer NOT NULL,
	`mime` text,
	`data` blob,
	`fetched_at` integer NOT NULL
);
