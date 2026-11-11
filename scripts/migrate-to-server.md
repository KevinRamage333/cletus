# Moving the Cletus database to an Oracle Cloud Always Free VM

The database runs locally on the build box today (PostgreSQL 17, set up by `scripts/db-init.sh`). These steps move it to the LLC-owned Oracle Cloud VM that will also run the trading worker. Postgres is **never** exposed to the internet: it listens on localhost and requires SSL, admin access goes through an SSH tunnel, and backups are encrypted before they leave the VM.

> Don't move real funds or flip `TRADING_MODE=live` as part of this. It's a database move only.

## 0. Prerequisites
- An Oracle Cloud account (unlocked), the Always Free **Ampere A1** shape (up to 4 OCPU / 24 GB) or an E2.1.Micro, with **Ubuntu 24.04** or **Oracle Linux 9**. The commands below assume Ubuntu.
- An SSH key pair on your laptop (`ssh-keygen -t ed25519`). Add the public key when you create the instance.
- This repo checked out locally, and the latest encrypted backup from the box, `~/cletus-backups/daily/cletus-<stamp>.dump.age` plus its `.sha256`.
- The **age private key** (`.secrets/backup-age.key` on the box), needed for the restore only. Copy it over a secure channel, never by email or chat.

## 1. Network: keep 5432 closed
1. In the VCN's **security list / NSG**, allow ingress **TCP 22 only**, ideally from your own IP (`<your-ip>/32`), plus 80/443 if the web app is served from this VM. **Do not add a rule for 5432.**
2. On the VM:
   ```bash
   sudo apt update && sudo apt -y upgrade
   sudo apt -y install ufw fail2ban unattended-upgrades
   sudo ufw default deny incoming && sudo ufw default allow outgoing
   sudo ufw allow OpenSSH            # add: sudo ufw allow 443/tcp   (only if serving the app here)
   sudo ufw deny 5432/tcp
   sudo ufw enable
   ```
   Oracle's Ubuntu images also ship iptables rules in `/etc/iptables/rules.v4`. Leave 5432 out of them as well.
3. SSH hardening in `/etc/ssh/sshd_config`: `PasswordAuthentication no` and `PermitRootLogin no`, then run `sudo systemctl restart ssh`.

## 2. Install PostgreSQL 17 + tools
```bash
sudo apt -y install curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update && sudo apt -y install postgresql-17 age openssl
```

## 3. SSL + localhost-only + hostssl-only
Use a real certificate if you have a hostname. Otherwise make a self-signed one (traffic is still encrypted; clients use `sslmode=require`):
```bash
sudo -u postgres openssl req -new -x509 -days 825 -nodes -subj "/CN=cletus-db" \
  -keyout /var/lib/postgresql/17/main/server.key -out /var/lib/postgresql/17/main/server.crt
sudo chmod 600 /var/lib/postgresql/17/main/server.key
```
Copy this repo's settings. They're the same files `scripts/db-init.sh` assumes:
```bash
sudo tee /etc/postgresql/17/main/conf.d/cletus.conf <<'CONF'
listen_addresses = 'localhost'
password_encryption = scram-sha-256
ssl = on
ssl_cert_file = '/var/lib/postgresql/17/main/server.crt'
ssl_key_file  = '/var/lib/postgresql/17/main/server.key'
ssl_min_protocol_version = 'TLSv1.2'
log_connections = on
CONF
sudo tee /etc/postgresql/17/main/pg_hba.conf <<'HBA'
local     all  postgres                peer
local     all  all                     reject
hostssl   all  all      127.0.0.1/32   scram-sha-256
hostssl   all  all      ::1/128        scram-sha-256
hostnossl all  all      0.0.0.0/0      reject
hostnossl all  all      ::/0           reject
HBA
sudo systemctl restart postgresql
sudo ss -ltnp | grep 5432      # must show 127.0.0.1:5432 / [::1]:5432 only
```

## 4. Code, secrets, roles and schemas
```bash
sudo useradd -m -s /bin/bash cletus && sudo -iu cletus
git clone <your-private-repo-url> /opt/cletus   # or rsync the repo (without .env.local/.secrets/node_modules)
cd /opt/cletus && npm ci
```
- **Fresh passwords (recommended):** create an empty `.env.local` with `chmod 600` and the non-DB secrets (`GEMINI_API_KEY`, `HELIUS_*`, …) re-entered by hand. Then run `scripts/db-init.sh`: it generates new role passwords and writes `DATABASE_URL`, `MARKET_DATA_DATABASE_URL`, `LLC_DATABASE_URL` and `BACKUP_DATABASE_URL`. The `cletus` user needs sudo for that one run, or you can run the two `psql` lines from the script as `postgres` yourself.
- Make a **new age key pair on your laptop** (`age-keygen -o cletus-backup.key`). Put **only the public key** on the server at `/opt/cletus/.secrets/backup-age.pub` (chmod 600). Keep the private key offline. The server can then write backups it can't read.

## 5. Restore the data
Copy the backup, the `.sha256` file and (temporarily) the age private key to the VM:
```bash
scp cletus-<stamp>.dump.age* cletus@<vm>:/opt/cletus/restore/
scp cletus-backup.key cletus@<vm>:/opt/cletus/.secrets/restore-age.key     # delete after step 5
cd /opt/cletus
BACKUP_AGE_IDENTITY=.secrets/restore-age.key scripts/db-restore.sh restore/cletus-<stamp>.dump.age              # drill into a scratch DB
BACKUP_AGE_IDENTITY=.secrets/restore-age.key scripts/db-restore.sh restore/cletus-<stamp>.dump.age cletus --force   # real restore
shred -u .secrets/restore-age.key
npm run db:migrate             # applies any newer Prisma migrations to the app schema
```
Note: if the backup came from the box, it was encrypted to the **box's** age key, so use that key for this one restore. Every backup taken on the VM uses the new public key.

## 6. Start the app/worker and verify
```bash
npm run build && npm start        # or a systemd unit / pm2; keep TRADING_MODE=paper
curl -s localhost:3000/api/health  # ok:true, marketData.enabled:true, lastError:null
```
The connection strings use `127.0.0.1` because the app and the DB are on the same VM. If you put the app elsewhere, use an SSH tunnel (below). Don't open 5432.

## 7. Nightly encrypted backups (off-box)
```bash
crontab -e   # as the cletus user (VM in UTC; 08:15 UTC = 02:15 America/Chicago in winter)
15 8 * * * cd /opt/cletus && BACKUP_DIR=/var/backups/cletus BACKUP_OFFSITE_CMD="oci os object put --bucket-name cletus-backups --force --file" scripts/db-backup.sh >> /var/log/cletus-backup.log 2>&1
```
- Create an **Object Storage bucket** `cletus-backups` (Always Free includes 20 GB), private, with versioning on, and install/configure the `oci` CLI for the `cletus` user. You can also use any S3-compatible target.
- Retention on the VM is 7 daily, 4 weekly and 6 monthly copies (built into the script). Set a bucket lifecycle rule to match, for example deleting objects after 200 days.
- **Monthly restore drill:** pull a backup to your laptop or a scratch VM and run `scripts/db-restore.sh <file>` with the offline key. It restores into `cletus_restore_test`, prints row counts and then drops the scratch DB.

## 8. Admin access: SSH tunnel only
From your laptop:
```bash
ssh -N -L 15432:127.0.0.1:5432 cletus@<vm-public-ip>
psql "host=127.0.0.1 port=15432 dbname=cletus user=cletus_llc sslmode=require"   # LLC records
```
GUI tools (DBeaver, TablePlus, pgAdmin) can use their built-in SSH tunnel option the same way. Nothing listens publicly on 5432.

## 9. Checklist
- [ ] `sudo ss -ltnp | grep 5432` shows localhost only; the security list has no 5432 rule; `ufw status` shows 5432 denied
- [ ] `psql "host=127.0.0.1 dbname=cletus user=cletus_app sslmode=disable"` is **rejected** (no encryption)
- [ ] `npx vitest run tests/db.pg.test.ts` passes on the VM (SSL, privilege boundaries, Prisma round trip)
- [ ] One backup ran and showed up in Object Storage; a restore drill succeeded
- [ ] `.env.local` and `.secrets/*` are chmod 600 and owned by `cletus`; the age **private** key is NOT on the VM
- [ ] Box copy: once the VM is live, stop the box cluster (`sudo pg_ctlcluster 17 main stop`) so there aren't two writers
