ALTER TABLE `outbox` ADD `task_id` text;--> statement-breakpoint
ALTER TABLE `outbox` ADD `deadline` text;--> statement-breakpoint
ALTER TABLE `outbox` ADD `reminder_version` integer;--> statement-breakpoint
CREATE INDEX `outbox_status_index` ON `outbox` (`status`);--> statement-breakpoint
CREATE INDEX `records_owner_kind_index` ON `records` (`owner`,`kind`);