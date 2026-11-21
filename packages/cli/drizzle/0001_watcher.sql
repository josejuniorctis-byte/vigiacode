ALTER TABLE `change_events` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `change_events` ADD `layer` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `change_events` ADD `diff_truncated` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `change_events_project_layer_idx` ON `change_events` (`project_id`,`layer`);--> statement-breakpoint
CREATE INDEX `change_events_batch_id_idx` ON `change_events` (`batch_id`);