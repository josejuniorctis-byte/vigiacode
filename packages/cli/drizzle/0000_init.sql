CREATE TABLE `bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`layer` text NOT NULL,
	`entity` text NOT NULL,
	`field` text NOT NULL,
	`status` text NOT NULL,
	`detected_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bindings_project_id_idx` ON `bindings` (`project_id`);--> statement-breakpoint
CREATE INDEX `bindings_project_layer_idx` ON `bindings` (`project_id`,`layer`);--> statement-breakpoint
CREATE TABLE `change_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`file_path` text NOT NULL,
	`change_type` text NOT NULL,
	`diff` text NOT NULL,
	`summary` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `change_events_project_id_idx` ON `change_events` (`project_id`);--> statement-breakpoint
CREATE INDEX `change_events_project_created_idx` ON `change_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_root_path_idx` ON `projects` (`root_path`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`commit_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshots_project_id_idx` ON `snapshots` (`project_id`);--> statement-breakpoint
CREATE INDEX `snapshots_project_commit_idx` ON `snapshots` (`project_id`,`commit_hash`);