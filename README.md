# Daymark — tasks, notes and learning

A personal workspace for tasks, notes, and learning topics, with German, English, and Ukrainian interfaces. Every entry supports text, headings, and code blocks with language selection, reordering, and copying. Data is stored in D1. Personal entries are isolated by authenticated user; shared entries are restricted to the workspace owner and invited members. Tasks have a status, priority, and optional deadline.

## Development

Requires Node.js 22.13 or later. After running `npm ci`, start the site and Telegram bot together with `npm run dev`. Local address: `http://localhost:5173`. Press `Ctrl+C` in the same terminal to stop both processes. No automatic startup is installed. Use `npm run dev:web` to run only the site. This project uses Sites; storage configuration and the site identifier are in `.openai/hosting.json`. Production schema changes use Drizzle migrations (`npm run db:generate`), rather than running during HTTP requests. For the local database, apply the SQL files in `drizzle/` in numerical order using the starter command: `wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file <migration.sql>`.

Each project copy has its own Vite cache in `.sites-runtime/node_modules/.vite`. The cache location is also included in the module version key to prevent the browser from mixing an older ReactDOM with a newer React. Test copies can share dependencies without overwriting modules used by the running site. After changing the cache configuration, restart `npm run dev` and perform a hard refresh (`Cmd+Shift+R` on macOS).

## Recurring tasks

Enable “Recurring task” in the task editor and select “Every day” or individual weekdays. The time is optional. The “Recurring” tab shows all recurring tasks, while “Today” shows tasks scheduled for the current day.

Completion applies to a specific date in your time zone. The task becomes active again on the next selected day. It remains a single entry with the same description and code blocks. Deleting it removes both the entry and its schedule.

Recurring tasks scheduled for today appear in the morning summary, even without a time. If a time is set, the bot sends a reminder 30 minutes beforehand, including across midnight. Each date has its own reminder key. A time skipped by daylight saving time is moved to the first available local minute.

The `drizzle/0002_complex_betty_ross.sql` migration adds schedule fields. It has already been applied to the local database while preserving existing entries. A backup was created in `.wrangler/backups/` before changing the local schema.

## Telegram: setup and startup

The local site requires sign-in through a Telegram bot: a one-time `/start` link, confirmation in a private chat, a Telegram ID association, and a 30-day HttpOnly session. Pages and API endpoints validate this session. Test cookies and third-party authentication headers do not grant access. Signing out revokes the session on the server. Personal entries are isolated by Telegram account. Shared entries require current workspace membership.

The sign-in page also completes confirmation after a reload or a return from Telegram. If an earlier version stored a confirmed account under a temporary `pending:` owner, it is restored under its Telegram owner only when the matching private cookie and a valid confirmation are present. A temporary owner cannot grant access to entries.

Local sign-in simulation is disabled. An older entry created under the local test identity is transferred after Telegram confirmation in the same browser with the old cookie. The old cookie alone does not authenticate the user.

The morning summary is sent at 08:00 Europe/Berlin, and deadline reminders are sent 30 minutes before the deadline.

The Telegram bot and reminders **start manually, only when needed**. `telegram/service.mjs` is a Node.js service with no additional dependencies. While running, it polls the bot through getUpdates and checks reminders every 15 seconds. A valid bot token is required. Shutting down the computer or stopping the service stops reminders.

1. Add your BotFather `TELEGRAM_BOT_TOKEN` to the private `telegram/.env` file. Git ignores this file. The `SITE_URL`, `SITES_ACCESS_TOKEN`, and `TELEGRAM_SERVICE_SECRET` fields have already been configured locally for this instance.
2. Set the same `TELEGRAM_SERVICE_SECRET` in the Sites secret variables. Redeploy to apply variable changes. The owner retrieves the private platform access token through Sites; it is separate from the Telegram bot token.
3. When needed, run `npm run dev` from the project root. The site and bot run together in the open terminal. The bot waits for the local server to become ready and connects to it without changing `SITE_URL` in the private file. Press `Ctrl+C` to stop both. If either process exits, the other stops too.
4. On the sign-in page, click “Sign in with Telegram”, open the bot link, and press Start. The site opens after confirmation.
5. To sign out, click the button next to your name in the sidebar. Repeat bot confirmation to sign in again.

The combined local startup uses `TELEGRAM_SERVICE_SECRET` from `.dev.vars`; it must be configured in that file. The private hosting token is not sent to the local server.

`.telegram-state/local/offset.json` stores the getUpdates offset for the combined local startup. Running the service separately uses `.telegram-state/offset.json`. Keep this directory between restarts. An existing bot webhook is not removed: the service stops and reports the conflict. Do not run multiple getUpdates processes for the same bot.

## Reminder behavior

The morning summary includes all incomplete regular tasks with deadlines, including overdue and future tasks, plus recurring tasks scheduled for today. It is created once per calendar day in the user's time zone, within a one-hour window after the selected time. No message is sent if there are no matching tasks. Disabled reminders are not created.

Deadlines are stored in UTC and edited and displayed in the selected time zone. Daylight saving time is accounted for; nonexistent local times are rejected. A reminder is created 30 minutes before the deadline, within the 15-second polling interval. A newly created task with a closer deadline receives a reminder on the next check. Completed and deleted tasks do not create reminders. Changing a deadline creates a new reminder version and cancels the previous unsent reminder.

Unique D1 keys prevent duplicate morning and deadline messages from being created. The delivery queue is claimed atomically. If the service fails during a Telegram request and delivery cannot be confirmed, the request is marked `unknown` and is not retried automatically. Telegram sendMessage has no idempotency key, so exactly-once delivery cannot be guaranteed during network failures. Explicit Telegram rejections are marked `failed`. Tokens and HTTP request contents are not written to logs.

## Checks

Run `npm exec tsc -- --noEmit`, `npm run lint`, `node scripts/check-domain.mjs`, and the build. Run `scripts/check-api.mjs` in an isolated project copy with a separate database and port, using `FOCUS_TEST_BASE_URL` and `FOCUS_TEST_SERVICE_SECRET`. HTTP checks cover mandatory sign-in, rejection of old cookies and spoofed headers, one-time codes, account isolation, sign-out, transfer of an older entry, CRUD, daily and weekly schedules, date-specific completion, and the reminder queue. The script refuses to run on the normal port, 5173.

In supported browsers, WebMCP exposes `list_entries` and `start_entry_creation`. Testing in an actual WebMCP browser requires an available browser context. These operations use the same APIs and authentication as the interface.

Automatic startup is not used. Start the site and bot together manually with `npm run dev`; pressing `Ctrl+C` stops both processes.

## Interface language

German, English, and Ukrainian are available on the sign-in page, in the top bar, and in settings. The selection is saved automatically: in the browser before sign-in, and also in the Telegram account after sign-in. Dates, the editor, and new reminders use the selected language. Your entry text and code are not translated.

The `drizzle/0003_skinny_nova.sql` migration has already been applied to the local database. It adds the language for accounts and sign-in links. Existing entries were preserved, and the backup is in `.wrangler/backups/`.

## Overdue tasks

After the deadline, an incomplete task automatically receives the “Overdue” status. The status is also calculated in the open list without a reload and is saved when the workspace is read or the bot checks tasks. Completed tasks and tasks without a deadline or scheduled time do not become overdue.

The bot sends one separate overdue notification in addition to the reminder 30 minutes before the deadline. Checks run every 15 seconds while the site and bot are running manually. After a manual restart, missed deadlines are checked. For recurring tasks, this covers the latest overdue date whose state is still stored. The message uses the selected interface language.

For recurring tasks, overdue status applies to an individual date; the next scheduled date starts active. Moving the deadline into the future or removing it clears overdue status. Editing text or reopening a task does not repeat the notification for the same deadline. The “Deadline reminder” setting controls messages before and after the deadline. Automatic status changes work independently of this setting.

Checks: `node scripts/check-domain.mjs` and `node scripts/check-overdue.mjs`. The latter runs the production status and notification queue code against a separate in-memory SQLite database. `scripts/check-overdue-api.mjs` is intended only for an isolated local server with a test database.

## Shared workspaces

Use the workspace selector in the sidebar to switch between your personal workspace and shared workspaces. Click **Shared workspaces**, enter a name, and select **Create**. A shared workspace starts empty and keeps its tasks, notes, and learning topics separate from personal entries. Its timezone is copied from the creator's settings when it is created, so recurring schedules and deadlines are consistent for all members.

The owner can select **Create invitation** and copy the generated Telegram link. Each link can be accepted once and expires after 7 days; create a separate invitation for each person. The recipient opens the link in a private chat with the bot and presses **Start**. For people on other computers, the website must be reachable at an external URL; a loopback address such as `localhost` only works on the computer running the site. The bot uses its configured `SITE_URL` for the **Open workspace** link. The combined `npm run dev` command uses the local server address, so external access also requires a hosting or network setup. The bot grants membership and offers **Open workspace**. Browser sign-in still uses the existing browser-bound Telegram confirmation; an invitation alone never creates a browser session. The workspace query parameter is preserved through sign-in.

Members can view, create, edit and complete tasks, notes and learning topics. Only the owner can delete entire shared entries, generate or revoke invitations, see the participant list, and remove members. Use **Remove access** beside a member to revoke their access. Existing sessions remain usable for personal data, but all shared read/write requests validate current membership. The open interface refreshes on focus and every 20 seconds. Used invitations cannot restore revoked membership; the owner must generate a new one. Records authored by a removed member remain in the workspace.

Invitations are stored as hashes, and the full link is shown only when it is created. Unused invitations can be revoked separately. “Shared” means access by invitation, not anonymous access or indexing by a public directory.

Each member receives shared-task deadline and overdue reminders using their own language and reminder preferences. The morning message combines personal and accessible shared tasks in one daily summary. Shared titles include the workspace name. Removing a member also cancels their queued messages containing that workspace's tasks. Membership is checked again immediately before sending claimed messages; messages already being sent or delivered cannot be recalled. The site and bot still run only when started manually.

The schema additions are in `drizzle/0004_silky_terror.sql` and `drizzle/0005_careful_dakota_north.sql`. Both have been applied to this local database after creating a private backup in `.wrangler/backups/`. For a fresh database, apply all migrations in numerical order. The new migrations add workspaces, members, hashed invitations, and notification access metadata without moving personal records.

Run `node scripts/check-workspaces.mjs` for isolated in-memory integration checks of production APIs, Telegram acceptance, ownership and member permissions, data isolation, single-use/expired/revoked invitations, concurrent revocation, removal and re-invitation, shared scheduling, per-recipient reminders, and a single combined morning summary. No real Telegram requests or changes to local user data are made by this check.
