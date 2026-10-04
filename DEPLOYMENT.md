# Deployment

The supported way to run the system is the Docker Compose stack at the repo root (ADR 0005): one `compose.yaml` runs the database, the backend, and nginx serving the dashboard on one port, and the same file is the laptop demo and the district server. Deploying it is one step, two ways:

- **[The deploy script](#the-deploy-script)**: `deploy/deploy.sh` on Linux and macOS, `deploy\deploy.ps1` on Windows Server. It writes `.env` with generated secrets, builds and starts the stack, waits for it to be healthy, and handles upgrades, backups, restores, and removal, on this server or on any number of servers over ssh.
- **[Ask your Claude agent](#ask-your-claude-agent)**: in Claude Code in this repo, say "deploy this to admin@closet-mon" and the agent runs the script for you.

[Docker Compose by hand](#docker-compose-by-hand) is what both of them do, step by step, and the fallback when you want each command in front of you. The manual PM2 and nginx install stays at the [bottom](#manual-install-without-docker) for a server that cannot run Docker.

Throughout this guide, replace `YOUR_DOMAIN` with the hostname the site is served on.

## The deploy script

A new Linux server needs nothing but git and a login with sudo. On the server:

```bash
git clone <repo-url> temperature-alarms
cd temperature-alarms
deploy/deploy.sh bootstrap             # Docker Engine, Compose, and cron; adds you to the docker group
exit                                   # log out and back in, so the docker group applies
cd temperature-alarms
deploy/deploy.sh deploy --yes          # port 80, default thresholds, no questions
deploy/deploy.sh schedule-backup       # optional: a backup every night at 02:00, a week kept
```

`deploy/deploy.sh` with no action shows a menu instead. `bootstrap` supports Ubuntu, Debian, RHEL, Rocky Linux, AlmaLinux, CentOS Stream, and Fedora. On a server without git yet (a minimal RHEL-family install), `sudo dnf install git` first, or run `bootstrap` from another machine with `--host` (below), which needs no checkout. Elsewhere, install Docker with the Compose v2 plugin yourself: Docker Desktop on macOS and Windows, Docker running Linux containers on Windows Server. On Windows:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1                 # Windows PowerShell 5.1
pwsh deploy/deploy.ps1 deploy --yes --web-port 8080                        # PowerShell 7
```

The two scripts are the same tool, with the same actions and the same flags; `--help` lists them. Run with no action, either one shows a menu. Every action also runs with `--yes`, which never prompts: it takes the flags given and the defaults for the rest.

| Action | What it does |
| --- | --- |
| `bootstrap` | Linux only. Installs Docker Engine, the Compose and buildx plugins, and containerd from Docker's own apt or dnf repository, the way [Docker's install guide](https://docs.docker.com/engine/install/) does it (signed by Docker's GPG key; not the `get.docker.com` script), plus git, curl, and cron (`cronie` on RHEL-family servers, whose minimal images have no cron). Enables and starts `docker` and cron, and adds you (the `sudo` caller) to the `docker` group. Uses `sudo` when not run as root. What is already installed is skipped, so it is safe to repeat. A server with a distribution `docker` but no Compose v2 is refused with the uninstall link rather than replaced |
| `preflight` | Checks Docker, Compose v2, that the daemon is up and runs Linux containers, that the web port is free (or already this stack's), and disk space |
| `install` | Creates `.env` from `.env.example` with `ADMIN_TOKEN`, `DEVICE_TOKEN`, and `DB_PASSWORD` from a cryptographic random source, asks for the port and, if you want, the thresholds and retention (`--web-port`, `--set KEY=VALUE` without asking), and limits `.env` to its owner. An existing `.env` is kept: only empty secrets are filled, and nothing else changes without a yes (or `--reconfigure`) |
| `deploy` | Runs `install` if there is no `.env`, offers `git pull --ff-only` on a clean checkout (`--pull` to do it unasked, `--no-pull` to skip), runs preflight, `docker compose up -d --build --wait`, then checks `/api/health` through `web`. This is also the upgrade |
| `status`, `logs` | `docker compose ps` and the health check; recent logs (`--service api`, `--tail 500`, `--follow`) |
| `backup` | `mysqldump` through the `db` container to `backups/<project>_<date>-<time>.sql.gz`, checked for completeness. `--keep-days N` then deletes this project's backups older than N days |
| `schedule-backup`, `unschedule-backup` | Adds a line to your crontab that runs `backup --keep-days 7` every night at 02:00 (`--at HH:MM`, `--keep-days N`), logging to `backups/backup.log`; or removes it. Repeating `schedule-backup` replaces its own line, found by a `# temperature-alarms backup: <checkout>` comment, and other crontab lines are never touched. Linux and macOS; in Git Bash or `deploy.ps1` on Windows it prints the `schtasks` command for Task Scheduler instead |
| `restore` | Replaces the database with a backup (`--file`, or pick from a list). Asks you to type the project name, and backs up the current database first |
| `migrate-legacy` | Backs up, then runs `npm run migrate:legacy` in `api` (see [Migrating an old database in](#migrating-an-old-database-in)) |
| `info` | The dashboard URL, the three secrets masked (`--reveal` to print them), and the two `config.h` lines for the firmware |
| `stop`, `uninstall` | `docker compose stop`; `docker compose down` and the built images. `--wipe` also deletes the database volume, behind the typed project name |

Running `deploy` twice is safe: an unchanged checkout leaves the containers running, and a changed one rebuilds and recreates only what changed. The destructive actions take `--confirm <project>` in place of typing the name, so they can be scripted too. The database volume is named after the Compose project, `<project>_db-data`, and the project is Compose's own default, the checkout's folder name. On first install the script writes that name into `.env` as `COMPOSE_PROJECT_NAME`, so renaming or moving the folder later still finds the same volume; it never rewrites the line. Pass `-p` only for a second stack on the same machine, and never to an existing install. An install made by hand before the script has no such line and keeps using the folder name; see [Docker Compose by hand](#docker-compose-by-hand) to pin it.

For a nightly backup, `deploy/deploy.sh schedule-backup` writes the crontab line for you. Backups stay on the server, so copy `backups/` somewhere else too.

### Many servers from one machine

From any machine with ssh access, give one or more servers and an action; the script runs itself on each one in turn and prints a summary:

```bash
deploy/deploy.sh deploy --host admin@closet-mon-hs --host admin@closet-mon-ms --yes
cp deploy/servers.example.txt deploy/servers.txt     # one USER@HOST per line; gitignored
deploy/deploy.sh bootstrap --servers deploy/servers.txt          # prepare new servers
deploy/deploy.sh deploy --bootstrap --servers deploy/servers.txt --yes   # or prepare and deploy in one go
deploy/deploy.sh schedule-backup --servers deploy/servers.txt --yes
deploy/deploy.sh status --servers deploy/servers.txt --yes
deploy/deploy.sh backup --servers deploy/servers.txt --yes
```

On each server it connects with plain `ssh`, clones the repo into `~/temperature-alarms` if it is not there yet (`--dir` for another path, such as an existing checkout; `--repo` and `--branch` for another source, by default this checkout's `origin`), and runs `deploy/deploy.sh` there with the same action and flags. So each server keeps its own `.env`, secrets, and `backups/`, and nothing secret crosses the network. A `deploy` to a remote server pulls the latest code first unless you pass `--no-pull`. With one server and no `--yes`, the menu and the prompts work over the ssh session.

`bootstrap` with `--host` or `--servers` copies `deploy.sh` to each server on its own and runs it there, so a server with no git and no checkout can be prepared from here. `deploy --bootstrap` runs `bootstrap` and then the deploy on each server; each is its own ssh login, so the deploy already has the new `docker` group. `sudo` on the server asks for your password when you run from a terminal; unattended (`--yes` from a script or an agent), the login needs passwordless sudo, and without it `bootstrap` stops and says so.

Apart from `bootstrap`, the servers need git, Docker with Compose v2, and a login that can run `docker` (in the `docker` group), which is what `bootstrap` sets up. Key-based ssh saves typing a password per server; extra ssh options go in `--ssh-opts "-p 2222 -i ~/.ssh/district"` or `DEPLOY_SSH_OPTS`. `deploy.ps1` takes the same `--host`, `--servers`, and `--bootstrap` flags and uses the OpenSSH client built into Windows. The remote side is always `deploy.sh`, so the targets are Linux or macOS servers; for a Windows server, run `deploy.ps1` on it.

## Ask your Claude agent

With [Claude Code](https://claude.com/claude-code) open in this repo, ask for what you want in plain words:

- "Set up the new server admin@closet-mon-hs" (bootstrap, then deploy)
- "Deploy this to admin@closet-mon-hs on port 8080"
- "Upgrade the servers in deploy/servers.txt"
- "Back up the database", "back up nightly", or "restore yesterday's backup"
- "Is the stack healthy?"

The `deploy` skill in `.claude/skills/deploy/` has the agent run the deploy script non-interactively. It asks only for what it cannot find out (the server and, on a first install, the port), runs preflight before deploying, never prints a token or password into the chat (it shows `info` masked and tells you how to reveal them yourself), asks you before a restore or a wipe, and finishes on the health check. It needs ssh to the server to work without a password prompt.

## Docker Compose by hand

The stack is three services on a private network:

| Service | What it is | Reachable from |
| --- | --- | --- |
| `db` | MySQL 8.4 with its data on the named volume `db-data` | `api` only, or `docker compose exec db` |
| `api` | The backend, one process (ADR 0001), built from `backend/Dockerfile` | `web` only, or `docker compose exec api` |
| `web` | nginx serving the built frontend and proxying `/api/` to `api` with the SSE settings, built from `frontend/Dockerfile` | `http://<host>:WEB_PORT`, port 80 by default |

Every service restarts unless stopped and has a healthcheck, logs are capped at three files of 10 MB each, and the dashboard's own origin serves the API, so no CORS setting is needed. The frontend is built with no API address on purpose: one image works on any hostname. nginx in `web` runs as a non-root user, so inside the container it listens on 8080; Compose publishes that on the host as `WEB_PORT`, still 80 by default, so nothing outside the container sees the 8080.

The database volume is named after the Compose project, `<project>_db-data`, and the project name defaults to the name of the folder the repo is cloned into, lower-cased: `temperature-alarms` below, `temperature-alarms-react` for the README's quick start clone. Run the stack from a renamed or moved folder and Compose starts on a new, empty volume, leaving the old one orphaned (`docker volume ls` shows both). To keep the name whatever the folder is called, set it in `.env`: `COMPOSE_PROJECT_NAME=temperature-alarms`, with the name `docker volume ls` shows before `_db-data`. The deploy script writes that line on first install, so a stack it installed keeps its volume through a rename, and it never changes the line afterwards.

### Setup

Install Docker: Docker Desktop on a laptop, or on Ubuntu Server [Docker Engine with the Compose plugin](https://docs.docker.com/engine/install/ubuntu/) (`docker compose version` should print a v2 number). Then:

```bash
git clone <repo-url> temperature-alarms
cd temperature-alarms
cp .env.example .env
nano .env
```

Set the three secrets; `docker compose up` refuses to start and names any that is empty:

| Variable | Value |
| --- | --- |
| `ADMIN_TOKEN` | The secret the Settings page sends with every change. Generate it with `openssl rand -hex 32` and hand it to the people who administer Campuses and Devices |
| `DEVICE_TOKEN` | The secret every Device sends with every Reading. Generate another one; it goes into each board's `config.h`, so rotating it means reflashing every Device (ADR 0003) |
| `DB_PASSWORD` | The password of the database user, and of MySQL root inside the stack. Generate a third one; nothing outside the stack can reach the database |

`WEB_PORT` is the only port published; leave it at 80 so boards and browsers need no port in their URL. Every other setting in `.env.example` is the backend's and has the default shown; set `LEGACY_TIME_ZONE` only when [migrating an old database in](#migrating-an-old-database-in). `.env` is gitignored.

### First run

```bash
docker compose up -d --build
docker compose ps        # wait until db, api, and web all say "healthy"
```

Migrating an old database? Stop here, before the first start, and go to [Migrating an old database in](#migrating-an-old-database-in): it needs an empty volume.

The first build downloads the base images and compiles both packages, a couple of minutes; later builds reuse the layers. On start, `api` waits for `db` to answer, creates or upgrades the schema itself through its migration runner, and `web` starts once `api` answers `/api/health`. Then open `http://<host>/` (with `:WEB_PORT` only if you changed it).

Walk the whole path once, before any Device is flashed. Open `http://<host>/settings`, paste the Admin token, add a Campus, and add a Device with the hostname `ESP_A1B2C3` (the commands below post as that hostname; any other gets a 404). With the dashboard open in another tab, post a Reading for that Device from the host:

```bash
set -a; source .env; set +a
curl http://localhost/api/health                       # {"status":"ok","database":"connected"}
curl -N http://localhost/api/dashboard/stream          # stays open and prints events; Ctrl-C
curl -i http://localhost/api/readings -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DEVICE_TOKEN" -d '{"device":"ESP_A1B2C3","temp":72,"humidity":40}'   # 201
curl -i http://localhost/api/readings -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer wrong' -d '{"device":"ESP_A1B2C3","temp":72,"humidity":40}'             # 401
```

The card should update without a reload, and the History link on it should show that Reading in today's list. For a card that keeps moving, run the virtual Device that ships in the `api` image; it reads the Device token and port from the container's environment, so only the hostname you registered is needed:

```bash
docker compose exec api node scripts/mock-device.mjs --hostname ESP_A1B2C3
docker compose exec api node scripts/mock-device.mjs --hostname ESP_A1B2C3 --count 3   # three Readings, then watch the card go Offline
```

Reset history on the Device's History page removes every Reading of the Device, so use it before the real Device starts reporting; or register a throwaway Device for the test and delete it afterwards, since its Readings go with it.

Useful commands:

```bash
docker compose logs -f api        # migrations, retention, legacy: lines
docker compose logs -f web        # nginx access and error log
docker compose restart api
docker compose down               # stop; the data stays on the volume
docker compose down -v            # stop and wipe the database
```

Once a day, and once at every start, the backend deletes Readings older than `RETENTION_DAYS` (90 unless `.env` says otherwise; see ADR 0004) and logs a line like `retention: removed 12480 readings older than ...`. Nothing is archived first: export anything you want to keep before it ages out.

### Upgrades

```bash
git pull
docker compose up -d --build
docker image prune -f             # drop the previous images
```

Compose rebuilds what changed and recreates only those containers. New schema migrations run on the first start of the new `api`, and the data on the volume is untouched. A change to `.env` needs `docker compose up -d` as well; Compose recreates the containers whose environment changed. Run every upgrade from the same folder, or with `COMPOSE_PROJECT_NAME` set as described above: a stack first started from a differently named folder keeps its old volume name, and `docker volume ls` shows which one holds the data.

The migration runner holds a MySQL lock while it works, so a second runner, such as `npm run migrate:legacy` started while `api` is still converting a large old database, waits for the first to finish. After ten minutes it gives up with `Another migration run still holds the lock`; run it again once the first has finished.

### Backups and restore

Everything lives in the `db-data` volume. Dump it through the `db` container:

```bash
set -a; source .env; set +a
docker compose exec db mysqldump -uroot -p"$DB_PASSWORD" temperature_alarms | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

For a nightly copy on a server, put that line in a script and run it from cron, keeping the last week:

```bash
sudo tee /usr/local/bin/backup-temperature-db.sh >/dev/null <<'EOS'
#!/bin/bash
cd /path/to/temperature-alarms || exit 1
set -a; source .env; set +a
DIR=/var/backups/temperature-alarms
mkdir -p "$DIR"
docker compose exec -T db mysqldump -uroot -p"$DB_PASSWORD" temperature_alarms | gzip > "$DIR/backup_$(date +%Y%m%d_%H%M%S).sql.gz"
find "$DIR" -name 'backup_*.sql.gz' -mtime +7 -delete
EOS
sudo chmod +x /usr/local/bin/backup-temperature-db.sh
# crontab -e:  0 2 * * * /usr/local/bin/backup-temperature-db.sh
```

Restore into a running stack (the `-T` matters, it lets the file stream in). Every command here that names `$DB_PASSWORD` needs `.env` loaded into the shell first, or MySQL is sent an empty password and refuses; `deploy/deploy.sh backup` and `restore` do all of this for you:

```bash
set -a; source .env; set +a
docker compose stop api
gunzip -c backup_20260909_020000.sql.gz | docker compose exec -T db mysql -uroot -p"$DB_PASSWORD" temperature_alarms
docker compose start api
```

To move to another machine, copy the repo, the `.env`, and a dump; `up -d --build` there, then restore. Keep `COMPOSE_PROJECT_NAME` in the copied `.env`, or clone into a folder of the same name, so the new machine's volume has the name the old one had.

### Migrating an old database in

A database from the PHP era or the first Node backend holds `devices`, `locations`, `alarms`, and one `ESP_xxxxxx` table per Device with the date and time as strings. The backend converts it on its first start (see [Upgrading a database from the old per-Device tables](#upgrading-a-database-from-the-old-per-device-tables) for what that does and how to verify it). With the stack, the order is: restore the old dump into an empty volume first, then let `api` start against it. The conversion runs only on the first start against a database: once `api` has started on an empty volume, its new tables are in place and every migration is recorded as done, so a dump restored over them is never converted and leaves `api` reading legacy tables it cannot use.

0. If the stack has run on this server before (a First run, or the deploy script's `deploy`), start from an empty database. This deletes everything in it, so back it up first if anything there matters:

   ```bash
   docker compose down -v
   ```

1. Dump the old database on the old server: `mysqldump temperature_alarms > old.sql`.
2. In `.env`, set `LEGACY_TIME_ZONE=America/Chicago`, the zone the old writer used. The container's own zone is UTC, so the default would parse every old timestamp six hours wrong. (`deploy/deploy.sh install --yes --set LEGACY_TIME_ZONE=America/Chicago` writes a new `.env` with it.)
3. Start only the database and restore into it:

   ```bash
   set -a; source .env; set +a
   docker compose up -d --wait db
   docker compose exec -T db mysql -uroot -p"$DB_PASSWORD" temperature_alarms < old.sql
   ```

4. Start the rest: `docker compose up -d --build` (or `deploy/deploy.sh deploy`). The first start of `api` renames the old tables, builds the new ones, and copies every row; watch `docker compose logs api` for lines starting `legacy:`, each naming a row it could not read and skipped. `api` starts listening only once the copy is done. A database that takes longer than about a minute outlasts the healthcheck, so `up` reports `api` unhealthy and leaves `web` stopped. That is harmless: wait for `Server is running on port 3001` in `docker compose logs api`, then run the same command again.
5. If an old writer keeps adding rows to an `ESP_` table after that (a board not yet reflashed, still posting to the old PHP endpoint), run the legacy migrations again; each run copies only rows added since. `deploy/deploy.sh migrate-legacy` backs up first and runs the same command:

   ```bash
   docker compose exec api npm run migrate:legacy
   ```

6. Verify the counts with the SQL in the section linked above, then drop the legacy tables by hand. Open the MySQL prompt with:

   ```bash
   set -a; source .env; set +a
   docker compose exec db mysql -uroot -p"$DB_PASSWORD" temperature_alarms
   ```

### TLS in front of the stack

The stack serves plain HTTP on purpose: a certificate needs a public hostname, and a laptop demo or a closet network has none. On the district server, put a TLS proxy on the host in front of the one published port. Move the stack off port 80 and keep it on the loopback address so only the proxy reaches it, `WEB_PORT=127.0.0.1:8080` in `.env`, then `docker compose up -d`.

Devices already flashed with `http://<host>` must keep reporting, and they cannot follow a redirect: the firmware's HTTP client logs `report: 308` and records nothing. So the proxy redirects browsers to HTTPS but passes `POST /api/readings` through on plain HTTP, for the domain and for any address a Device was flashed with.

The shortest proxy is [Caddy](https://caddyserver.com/docs/install), which obtains and renews the certificate itself. `/etc/caddy/Caddyfile`:

```
# Plain HTTP: Devices keep posting Readings, everything else moves to HTTPS.
(plain_http) {
	handle /api/readings {
		reverse_proxy 127.0.0.1:8080
	}
	handle {
		redir https://YOUR_DOMAIN{uri} 308
	}
}

YOUR_DOMAIN {
	reverse_proxy 127.0.0.1:8080 {
		flush_interval -1
	}
}

http://YOUR_DOMAIN {
	import plain_http
}

# Devices flashed with the server's IP address rather than its hostname.
http:// {
	import plain_http
}
```

`flush_interval -1` keeps the SSE stream unbuffered. Keep `http://YOUR_DOMAIN` as a block of its own: listed together with `http://`, Caddy drops the hostname and adds its own redirect for the domain in front of the Readings route. `sudo systemctl reload caddy`, open the firewall (`sudo ufw allow OpenSSH`, `sudo ufw allow 80,443/tcp`, `sudo ufw enable`), and the site is on `https://YOUR_DOMAIN`.

With nginx and certbot instead, follow steps 5 and 6 of the [manual install](#5-nginx), which give the same split, with every `proxy_pass` pointed at `http://127.0.0.1:8080` and the snippet's `root`, `index`, and asset locations replaced by a single `location /` carrying the same `proxy_*` lines as its `/api/` block.

No Device needs to change at certificate renewal: one with an `https://` server URL sends over TLS without checking the certificate (see the firmware section of the README). One with `http://YOUR_DOMAIN`, or `http://` and the server's address, keeps posting over plain HTTP through the blocks above; with the stack on `127.0.0.1:8080`, the proxy is now the only way in.

Behind this proxy there are two hops, the proxy and the stack's own nginx, and the backend trusts one (`trust proxy` is 1). It sees every request as coming from the host proxy, so the general limit of 500 API requests per 15 minutes per address (Readings have their own per-Device limit and are not counted) is shared by every browser together. A handful of open dashboards stays far below it. If browsers start getting 429s, that shared allowance is the cause.

## Upgrading a database from the old per-Device tables

Both paths share this. The first start of the new backend against an old database (see ADR 0002):

1. renames `devices` and `locations` to `legacy_devices` and `legacy_locations`, then builds the new `campuses`, `devices`, and `readings` tables;
2. copies each legacy location into `campuses` and each legacy device into `devices`, matching the old free-text `Campus` column against a shortcode first and a name second;
3. copies every row of every `ESP_xxxxxx` table into `readings`, parsing the string date and time in `LEGACY_TIME_ZONE`, which defaults to the server's own zone. The PHP writer pinned America/Chicago, so set `LEGACY_TIME_ZONE=America/Chicago` in `.env` if the server (or the container, which is always UTC) is not on Central time.

Nothing legacy is dropped. Every row that cannot be read (an unparseable date or time, a device whose campus is unknown, a table with no device row) is logged with its table and id and skipped, so watch the backend log for lines starting `legacy:` on that first start. The runner applies each migration once; `npm run migrate:legacy` from `backend/` (or through `docker compose exec api`) runs the legacy migrations again by hand. It is safe to repeat: each `ESP_` table's progress is kept in `legacy_readings_progress`, so a later run copies nothing twice and picks up only rows added since.

Before dropping anything, verify the numbers. For each Device, the legacy row count should equal the copied count plus the skipped count in `legacy_readings_progress`:

```sql
SELECT table_name, last_id, copied, skipped FROM legacy_readings_progress;
SELECT COUNT(*) FROM `ESP_2EB804`;
```

The copied rows are not all still in `readings`. Seconds after the copy, the backend's startup retention pass deletes every Reading older than `RETENTION_DAYS` (90 by default), copied ones included. So for a Device with more history than that, `copied` is larger than its count in `readings`, and that is correct. Compare inside the retention window instead, from a whole local day inside it, `CUTOFF_DAY` (the first start of the new backend minus 89 days, as `YYYY-MM-DD`), up to that first start, `FIRST_START` in UTC (reflashed boards start adding new Readings at once):

```sql
SELECT COUNT(*) FROM readings r JOIN devices d ON d.id = r.device_id
 WHERE d.hostname = 'ESP_2EB804'
   AND CONVERT_TZ(r.recorded_at, '+00:00', '-06:00') >= 'CUTOFF_DAY'
   AND r.recorded_at < 'FIRST_START';
SELECT COUNT(*) FROM `ESP_2EB804` WHERE STR_TO_DATE(`DATE`, '%m/%d/%Y') >= 'CUTOFF_DAY';
```

The two should agree, less the rows from that window logged as `legacy:` skips, give or take the Readings of one hour at the cutoff (the fixed `-06:00` is Central standard time; it is an hour off in summer). Both old writers stored `DATE` as `m/d/Y`; use `'%Y-%m-%d'` for a table that holds ISO dates. Leave out the `FIRST_START` bound if `migrate:legacy` copied rows added after the first start.

Then compare one legacy row with its reading, rendered back in the legacy zone, to confirm the timestamps read the right way round:

```sql
SELECT DATE, TIME, TEMP FROM `ESP_2EB804` ORDER BY ID DESC LIMIT 1;
SELECT CONVERT_TZ(r.recorded_at, '+00:00', 'America/Chicago') AS local_time, r.temp_f
  FROM readings r JOIN devices d ON d.id = r.device_id
 WHERE d.hostname = 'ESP_2EB804' ORDER BY r.recorded_at DESC LIMIT 1;
```

Once the counts agree, drop the legacy tables by hand, one `DROP TABLE` per `ESP_xxxxxx` table plus `legacy_devices`, `legacy_locations`, `alarms`, and `legacy_readings_progress`. Take a backup first. `CONVERT_TZ` with a named zone needs the MySQL time zone tables loaded (`mysql_tzinfo_to_sql /usr/share/zoneinfo | mysql mysql` as root; the MySQL image ships without zoneinfo); use a fixed offset like `'-06:00'` otherwise.

## Manual install (without Docker)

The fallback for a server that cannot run Docker. A single Ubuntu server runs everything: nginx serves the built frontend and proxies `/api/` to the backend, PM2 keeps the backend running as one process, and MySQL holds the data. Replace `/path/to/frontend/dist` with wherever you copy the frontend build.

### 1. Server packages

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx mysql-server certbot python3-certbot-nginx git
sudo npm install -g pm2
```

### 2. MySQL

```bash
sudo mysql_secure_installation
sudo mysql -u root -p
```

```sql
CREATE DATABASE temperature_alarms;
CREATE USER 'tempuser'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON temperature_alarms.* TO 'tempuser'@'localhost';
FLUSH PRIVILEGES;
```

The backend creates and upgrades the schema itself: every start runs its migration runner, which applies whatever has not run yet and records it in `schema_migrations`. A fresh database needs nothing beyond the `CREATE DATABASE` above. An old database is converted on the first start; see [Upgrading a database from the old per-Device tables](#upgrading-a-database-from-the-old-per-device-tables), and watch `pm2 logs temperature-api` for the `legacy:` lines.

### 3. Clone and build

```bash
sudo mkdir -p /var/www/temperature-alarms
sudo chown -R $USER:$USER /var/www/temperature-alarms
git clone <repo-url> /var/www/temperature-alarms
cd /var/www/temperature-alarms
npm run install:all
```

#### Backend

```bash
cd backend
cp .env.example .env
nano .env
npm run build
```

The backend refuses to start until these are set, naming whatever is missing:

| Variable | Value |
| --- | --- |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | The MySQL user and database from step 2 (`DB_HOST` and `DB_PORT` default to `localhost:3306`) |
| `ADMIN_TOKEN`, `DEVICE_TOKEN` | The two shared secrets, as in the Compose [setup](#setup) table |

`CORS_ORIGIN` can stay unset: through the nginx below the dashboard and the API share one origin, which the backend always accepts. Set it only if the dashboard is served from somewhere else. Leave `REPORT_INTERVAL_SECONDS` at 30 unless the firmware interval changes with it, and set `LEGACY_TIME_ZONE` only when upgrading an old database (step 2). Every other setting has a default that `.env.example` shows.

#### Frontend

```bash
cd ../frontend
cp .env.example .env.production
nano .env.production   # VITE_API_URL=https://YOUR_DOMAIN
npm run build          # output lands in frontend/dist
sudo mkdir -p /path/to/frontend/dist
sudo cp -r dist/* /path/to/frontend/dist/
```

### 4. PM2

The backend must run as exactly one process (see ADR 0001). `backend/ecosystem.config.js` is already set to a single fork-mode instance; do not raise `instances`.

```bash
cd /var/www/temperature-alarms/backend
pm2 start ecosystem.config.js
pm2 save
pm2 startup     # run the command it prints
```

Useful commands:

```bash
pm2 logs temperature-api
pm2 restart temperature-api
pm2 monit
```

The retention job runs here exactly as in the stack: once a day and once at every start, logging a `retention:` line.

### 5. nginx

Start on plain HTTP, the shape certbot needs in step 6. The site itself goes in a snippet that the HTTP server includes now and the HTTPS server includes after step 6. Create `/etc/nginx/snippets/temperature-alarms.conf`:

```nginx
root /path/to/frontend/dist;
index index.html;

# Backend API, including the SSE stream
location /api/ {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Required for Server-Sent Events: no buffering, long read timeout
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
}

# React Router: every unknown path serves index.html
location / {
    try_files $uri $uri/ /index.html;
}

# Hashed build assets can be cached forever
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

Then `/etc/nginx/sites-available/YOUR_DOMAIN`. `default_server` makes it answer a Device flashed with the server's IP address as well as its name:

```nginx
server {
    listen 80 default_server;
    server_name YOUR_DOMAIN;
    include snippets/temperature-alarms.conf;
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/YOUR_DOMAIN /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

The site is now on `http://YOUR_DOMAIN`.

### 6. TLS

Get the certificate without letting certbot edit the site, since its redirect would also catch the Devices' plain-HTTP Readings, which cannot follow one:

```bash
sudo certbot certonly --nginx -d YOUR_DOMAIN --deploy-hook "systemctl reload nginx"
sudo certbot renew --dry-run
```

Then replace `/etc/nginx/sites-available/YOUR_DOMAIN` with an HTTPS server for the site and an HTTP server that passes Readings through and sends everything else to HTTPS:

```nginx
# Plain HTTP: Devices keep posting Readings, everything else moves to HTTPS.
server {
    listen 80 default_server;
    server_name YOUR_DOMAIN;

    location = /api/readings {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        return 301 https://YOUR_DOMAIN$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name YOUR_DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;

    include snippets/temperature-alarms.conf;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Certbot installs a systemd timer that renews the certificate before it expires, and the deploy hook reloads nginx so the new one is served; `systemctl list-timers certbot.timer` shows the next run, and the dry run above proves the renewal works. No Device needs to change at renewal: one with an `https://` server URL sends over TLS without checking the certificate (see the firmware section of the README), and one with `http://` keeps posting through the HTTP server above.

### 7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### Updating

```bash
cd /var/www/temperature-alarms
git pull
npm run install:all
npm run build:all
sudo cp -r frontend/dist/* /path/to/frontend/dist/
pm2 restart temperature-api
```

### Checks

```bash
curl https://YOUR_DOMAIN/api/health
curl -N https://YOUR_DOMAIN/api/dashboard/stream   # should stay open and print events
pm2 logs temperature-api
sudo tail -f /var/log/nginx/error.log
```

Then walk the same path as the Compose [first run](#first-run), with `https://YOUR_DOMAIN` in place of `http://localhost` and the virtual Device run from `backend/` on the server: `node scripts/mock-device.mjs --hostname ESP_A1B2C3 --token "$DEVICE_TOKEN"`.

### Database backups

```bash
sudo tee /usr/local/bin/backup-temperature-db.sh >/dev/null <<'EOS'
#!/bin/bash
DIR=/var/backups/temperature-alarms
mkdir -p "$DIR"
mysqldump --defaults-extra-file=/root/.my.cnf temperature_alarms | gzip > "$DIR/backup_$(date +%Y%m%d_%H%M%S).sql.gz"
find "$DIR" -name 'backup_*.sql.gz' -mtime +7 -delete
EOS
sudo chmod +x /usr/local/bin/backup-temperature-db.sh
# crontab -e:  0 2 * * * /usr/local/bin/backup-temperature-db.sh
```

Put the database credentials in `/root/.my.cnf` (mode 600) rather than in the script.
