CREATE TABLE `roadmap_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'p2' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`module` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`done_at` text,
	`evidence_json` text,
	`checklist_json` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `roadmap_items_project_idx` ON `roadmap_items` (`project_id`);--> statement-breakpoint
CREATE INDEX `roadmap_items_project_status_idx` ON `roadmap_items` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `roadmap_items_project_priority_idx` ON `roadmap_items` (`project_id`,`priority`);--> statement-breakpoint
CREATE INDEX `roadmap_items_project_kind_idx` ON `roadmap_items` (`project_id`,`kind`);--> statement-breakpoint
CREATE INDEX `roadmap_items_project_module_idx` ON `roadmap_items` (`project_id`,`module`);--> statement-breakpoint
CREATE INDEX `roadmap_items_source_lookup_idx` ON `roadmap_items` (`project_id`,`kind`,`source`,`source_ref`);--> statement-breakpoint
CREATE TABLE `roadmap_links` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`binding_id` text,
	`file_path` text,
	`commit_sha` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `roadmap_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`binding_id`) REFERENCES `bindings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `roadmap_links_item_idx` ON `roadmap_links` (`item_id`);--> statement-breakpoint
CREATE INDEX `roadmap_links_binding_idx` ON `roadmap_links` (`binding_id`);--> statement-breakpoint
CREATE INDEX `roadmap_links_file_idx` ON `roadmap_links` (`file_path`);