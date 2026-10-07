CREATE TABLE `auth_links` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`browser_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`confirmed` integer DEFAULT 0 NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`chat_id` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`owner` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'Europe/Berlin' NOT NULL,
	`morning_time` text DEFAULT '08:00' NOT NULL,
	`morning_enabled` integer DEFAULT 1 NOT NULL,
	`deadline_enabled` integer DEFAULT 1 NOT NULL,
	`telegram_id` text,
	`telegram_name` text,
	`telegram_required` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preferences_telegram_id_unique` ON `preferences` (`telegram_id`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`topic` text DEFAULT '' NOT NULL,
	`blocks` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`due_at` text,
	`reminder_version` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_state` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text,
	`heartbeat` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL
);
