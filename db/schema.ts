import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
export const records = sqliteTable('records', {
 id: text('id').primaryKey(), owner: text('owner').notNull(), kind: text('kind').notNull(), title: text('title').notNull(), topic: text('topic').notNull().default(''), blocks: text('blocks').notNull().default('[]'), status: text('status').notNull().default('todo'), priority: text('priority').notNull().default('normal'), dueAt: text('due_at'), repeatDays: text('repeat_days'), repeatTime: text('repeat_time'), statusDate: text('status_date'), reminderVersion: integer('reminder_version').notNull().default(0), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
}, t => [index('records_owner_kind_index').on(t.owner, t.kind)]);
export const preferences = sqliteTable('preferences', {
 owner: text('owner').primaryKey(), language:text('language').notNull().default('uk'), timezone: text('timezone').notNull().default('Europe/Berlin'), morningTime: text('morning_time').notNull().default('08:00'), morningEnabled: integer('morning_enabled').notNull().default(1), deadlineEnabled: integer('deadline_enabled').notNull().default(1), telegramId: text('telegram_id').unique(), telegramName: text('telegram_name'), telegramRequired: integer('telegram_required').notNull().default(0)
});
export const authLinks = sqliteTable('auth_links', {hash: text('hash').primaryKey(), owner: text('owner').notNull(), browserHash: text('browser_hash').notNull(), language:text('language').notNull().default('uk'), expiresAt: integer('expires_at').notNull(), confirmed: integer('confirmed').notNull().default(0), used: integer('used').notNull().default(0)});
export const sessions = sqliteTable('sessions', {hash:text('hash').primaryKey(), owner:text('owner').notNull(), expiresAt:integer('expires_at').notNull()});
export const outbox = sqliteTable('outbox', {id:text('id').primaryKey(), owner:text('owner').notNull(), chatId:text('chat_id').notNull(), message:text('message').notNull(), status:text('status').notNull().default('pending'), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(), error:text('error'), workspaceId:text('workspace_id'), workspaceIds:text('workspace_ids').notNull().default('[]'), taskId:text('task_id'), deadline:text('deadline'), reminderVersion:integer('reminder_version')}, t => [index('outbox_status_index').on(t.status)]);
export const serviceState = sqliteTable('service_state', {id:text('id').primaryKey(), username:text('username'), heartbeat:integer('heartbeat').notNull().default(0)});

export const workspaces = sqliteTable('workspaces', {
 id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(),
 timezone: text('timezone').notNull(), createdAt: text('created_at').notNull()
}, t => [index('workspaces_owner_index').on(t.owner)]);
export const workspaceMembers = sqliteTable('workspace_members', {
 workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
 userId: text('user_id').notNull(), joinedAt: text('joined_at').notNull()
}, t => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('workspace_members_user_index').on(t.userId)]);
export const workspaceInvites = sqliteTable('workspace_invites', {
 id: text('id').primaryKey(), hash: text('hash').notNull().unique(),
 workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
 createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(),
 expiresAt: integer('expires_at').notNull(), revokedAt: integer('revoked_at'),
 usedBy: text('used_by'), claimId: text('claim_id')
}, t => [index('workspace_invites_workspace_index').on(t.workspaceId)]);
