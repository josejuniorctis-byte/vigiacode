CREATE TABLE `binding_file_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`file_path` text NOT NULL,
	`hash` text NOT NULL,
	`layer` text NOT NULL,
	`extractor` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `binding_file_cache_path_idx` ON `binding_file_cache` (`project_id`,`file_path`);--> statement-breakpoint
CREATE INDEX `binding_file_cache_project_idx` ON `binding_file_cache` (`project_id`);--> statement-breakpoint
CREATE TABLE `binding_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`files_scanned` integer DEFAULT 0 NOT NULL,
	`red_count` integer DEFAULT 0 NOT NULL,
	`yellow_count` integer DEFAULT 0 NOT NULL,
	`green_count` integer DEFAULT 0 NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`resolved_count` integer DEFAULT 0 NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`batch_id` text,
	`matrix_json` text,
	`error` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `binding_scans_project_idx` ON `binding_scans` (`project_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `binding_scans_batch_idx` ON `binding_scans` (`batch_id`);--> statement-breakpoint
ALTER TABLE `bindings` ADD `rule_id` text DEFAULT 'GREEN' NOT NULL;--> statement-breakpoint
ALTER TABLE `bindings` ADD `severity` text DEFAULT 'green' NOT NULL;--> statement-breakpoint
ALTER TABLE `bindings` ADD `message` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bindings` ADD `front_ref` text;--> statement-breakpoint
ALTER TABLE `bindings` ADD `back_ref` text;--> statement-breakpoint
ALTER TABLE `bindings` ADD `db_ref` text;--> statement-breakpoint
ALTER TABLE `bindings` ADD `suggestion` text;--> statement-breakpoint
ALTER TABLE `bindings` ADD `first_seen_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;--> statement-breakpoint
ALTER TABLE `bindings` ADD `last_seen_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;--> statement-breakpoint
ALTER TABLE `bindings` ADD `resolved_at` text;--> statement-breakpoint
ALTER TABLE `bindings` ADD `accepted` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `bindings_project_status_idx` ON `bindings` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `bindings_project_rule_idx` ON `bindings` (`project_id`,`rule_id`);--> statement-breakpoint
CREATE INDEX `bindings_project_entity_idx` ON `bindings` (`project_id`,`entity`);--> statement-breakpoint
CREATE INDEX `bindings_project_resolved_idx` ON `bindings` (`project_id`,`resolved_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `bindings_identity_idx` ON `bindings` (`project_id`,`rule_id`,`layer`,`entity`,`field`);