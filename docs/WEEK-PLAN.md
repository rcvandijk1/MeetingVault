# Build week: the think tank on a headless mini PC

The code is built and tested. This week turns it into a running department
on a box of its own, measures the baseline it has to beat, and runs the
first real problems. Each day ends with an exit test. Do not start the next
day until the exit test passes; the days are ordered so that a failure
early costs an hour, not a night of tokens.

Assumptions: a mini PC with 8 GB RAM and 64 GB of disk or more, your
Claude Max subscription, a laptop on the same network for SSH, and a phone
you want to read the board from. The box never gets a keyboard, mouse or
monitor: it is installed from your laptop and only ever reached over SSH.
Nothing else runs on it. Ever.

---

## Day 1 (Mon): the box, with nothing plugged in but power and Ethernet

**Goal:** a clean, locked-down machine you can SSH into, that can run one
headless Claude call.

The operating system is installed without ever seeing the box's screen.
Three ways, pick by hardware:

| Your hardware | Path | Needs |
|---------------|------|-------|
| x86 mini PC and you can reach its SSD (open the case, or a USB-to-NVMe/SATA adapter) | **A: image the disk from the laptop** | the adapter, 20 minutes, no keystroke on the box ever |
| x86 mini PC, disk stays inside | **B: USB installer with autoinstall** | a USB stick; one keystroke on the box unless you remaster the ISO |
| Raspberry Pi 4/5 | **C: Raspberry Pi Imager** | the SD card or NVMe in the laptop |

Whichever path, prepare two things on the laptop first:

- An SSH key for this box: `ssh-keygen -t ed25519 -f ~/.ssh/thinktank -C thinktank`.
  Its public half goes into the seed below.
- A seed file `user-data` (cloud-init). This is the whole Day 1 setup,
  applied on first boot:
  ```yaml
  #cloud-config
  hostname: thinktank
  timezone: Europe/Amsterdam
  users:
    - name: thinktank
      groups: [sudo]
      shell: /bin/bash
      sudo: ALL=(ALL) NOPASSWD:ALL
      ssh_authorized_keys:
        - ssh-ed25519 AAAA...your key...  thinktank
  ssh_pwauth: false
  package_update: true
  package_upgrade: true
  packages: [avahi-daemon, ufw, unattended-upgrades, git, python3, python3-venv, python3-pip, sqlite3, curl]
  runcmd:
    - ufw default deny incoming
    - ufw default allow outgoing
    - ufw allow from 192.168.0.0/16 to any port 22   # your LAN range
    - ufw --force enable
  ```
  and a two-line `meta-data`:
  ```yaml
  instance-id: thinktank-1
  local-hostname: thinktank
  ```
  `avahi-daemon` is what lets you type `ssh thinktank@thinktank.local`
  instead of hunting for an IP address.

**Path A: image the disk from the laptop.** No installer runs; the box
boots straight into a configured system.

1. Download the Ubuntu 24.04 server cloud image
   (`ubuntu-24.04-server-cloudimg-amd64.img` from cloud-images.ubuntu.com).
   It boots on UEFI and BIOS machines and grows to fill the disk on first boot.
2. Connect the box's SSD to the laptop. Find it with `lsblk`; be certain of
   the device name, this wipes it.
   ```bash
   qemu-img convert -O raw ubuntu-24.04-server-cloudimg-amd64.img /tmp/ubuntu.raw   # macOS: brew install qemu; Linux: apt install qemu-utils
   sudo dd if=/tmp/ubuntu.raw of=/dev/sdX bs=4M status=progress conv=fsync
   ```
3. Put the seed on any small USB stick formatted FAT32 with the volume
   label `CIDATA`, containing `user-data` and `meta-data` at its root.
   cloud-init looks for that label on first boot.
4. SSD back in the box, CIDATA stick in a USB port, Ethernet in, power on.
   Wait five minutes (package upgrade). Then from the laptop:
   ```bash
   ssh -i ~/.ssh/thinktank thinktank@thinktank.local
   ```
   Once in, pull the stick out; it is not needed again. Windows laptop:
   Rufus writes the raw image in DD mode; the CIDATA stick is just a FAT32
   format with that label.

**Path B: USB installer with autoinstall.** The disk stays in the box.

1. Write the Ubuntu 24.04 live-server ISO to a USB stick (Rufus,
   balenaEtcher, or `dd`).
2. Second USB stick, FAT32, label `CIDATA`, with `meta-data` as above and
   this `user-data` (the installer's own format; the cloud-config from
   above rides inside it):
   ```yaml
   #cloud-config
   autoinstall:
     version: 1
     locale: en_US.UTF-8
     keyboard: {layout: us}
     storage: {layout: {name: direct}}
     identity:
       hostname: thinktank
       username: thinktank
       password: "<output of: openssl passwd -6>"
     ssh:
       install-server: true
       allow-pw: false
       authorized-keys: ["ssh-ed25519 AAAA...your key... thinktank"]
     packages: [avahi-daemon, ufw, unattended-upgrades, git, python3-venv, python3-pip, sqlite3, curl]
     timezone: Europe/Amsterdam
     late-commands:
       - curtin in-target -- ufw default deny incoming
       - curtin in-target -- ufw allow from 192.168.0.0/16 to any port 22
       - curtin in-target -- ufw --force enable
   ```
3. Both sticks in, Ethernet in, power on. A mini PC with an empty disk
   boots the USB installer by itself; one with Windows preinstalled needs
   the boot-menu key once, which means borrowing a keyboard for ten
   seconds. The installer also asks "Continue with autoinstall?" once
   unless the ISO's kernel line carries `autoinstall`; that is the second
   place a borrowed keyboard saves you an ISO remaster. If you have no
   keyboard at all, use path A.
4. The box reboots itself into the installed system. Pull both sticks,
   `ssh -i ~/.ssh/thinktank thinktank@thinktank.local`.

**Path C: Raspberry Pi.** Raspberry Pi Imager, choose Ubuntu Server 24.04
64-bit, click the gear: hostname `thinktank`, user `thinktank`, paste the
SSH public key, disable password login, set Wi-Fi if no Ethernet. Write,
insert, power on, `ssh thinktank@thinktank.local`. Then run the `packages`
and `ufw` lines from the seed by hand.

**Finding the box if `.local` does not resolve:** your router's DHCP
client list, or from the laptop `nmap -sn 192.168.1.0/24` and look for the
new host. Then give the box a fixed address in the router (DHCP
reservation) so `web_host` on Day 2 stays valid.

The rest of Day 1 is over SSH:

3. Confirm the seed did its job, then set the time zone if path C skipped it:
   ```bash
   sudo ufw status && timedatectl && ssh -T localhost 2>&1 | head -1
   sudo timedatectl set-timezone Europe/Amsterdam
   ```
4. Install Claude Code. Native installer first; npm as the fallback.
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash        # native build, no Node needed
   # fallback: install Node 22 (nodesource) then: npm install -g @anthropic-ai/claude-code
   claude --version
   ```
5. Headless login. A box without a browser uses a long-lived token,
   created inside your SSH session:
   ```bash
   claude setup-token
   ```
   It prints a URL. Open that URL in the browser on your laptop, approve
   with your Claude account, and paste the code it gives you back into the
   SSH session.
   Put the token it prints in an environment file the services will read:
   ```bash
   sudo install -m 600 -o thinktank -g thinktank /dev/null /etc/thinktank.env
   echo 'CLAUDE_CODE_OAUTH_TOKEN=<paste>' | sudo tee /etc/thinktank.env >/dev/null
   ```
   Never put an `ANTHROPIC_API_KEY` on this box while `auth_mode` is
   subscription; the runner strips it anyway.
6. Clone and test:
   ```bash
   git clone <your repo url> ~/thinktank && cd ~/thinktank
   git checkout claude/artifact-build-dw4ib9        # or main once merged
   python3 -m venv .venv && . .venv/bin/activate
   pip install -e ".[dev]"
   python -m pytest -q                               # expect 58 passed
   ```

**Exit test:**
```bash
set -a; . /etc/thinktank.env; set +a
claude -p "Reply with the single word OK" --model haiku --tools "" --output-format json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['result'],d['total_cost_usd'])"
```
prints `OK` and a cost below a cent. If it asks you to log in, the token is
not in the environment.

---

## Day 2 (Tue): the service

**Goal:** daemon and board run under systemd, survive a reboot, reachable from your phone.

1. Config. Copy and edit; absolute paths, your LAN or Tailscale address:
   ```bash
   cp thinktank.example.toml thinktank.toml
   ```
   ```toml
   db_path = "/home/thinktank/thinktank/data/thinktank.sqlite3"
   agent_dir = "/home/thinktank/thinktank/data/agents"
   auth_mode = "subscription"
   run_window = "22:00-07:00"
   spend_max_usd_month = 100.0
   max_usd_per_run = 8.0
   web_host = "192.168.1.50"      # this box's fixed LAN address, or its Tailscale IP
   web_port = 8765
   [models]
   reader = "haiku"
   thinker = "opus"
   critic = "sonnet"
   synthesizer = "opus"
   judge = "sonnet"
   ```
   `mkdir -p data && thinktank init`
2. Phone access. Simplest safe option: Tailscale on the box and the phone,
   bind `web_host` to the box's Tailscale IP, and do not open the port on
   the LAN at all. Otherwise allow the port from your LAN only:
   `sudo ufw allow from 192.168.0.0/16 to any port 8765`. The board has no
   login; never expose it beyond that.
3. systemd units. `/etc/systemd/system/thinktank-daemon.service`:
   ```ini
   [Unit]
   Description=Think tank supervisor
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=thinktank
   WorkingDirectory=/home/thinktank/thinktank
   EnvironmentFile=/etc/thinktank.env
   Environment=THINKTANK_CONFIG=/home/thinktank/thinktank/thinktank.toml
   ExecStart=/home/thinktank/thinktank/.venv/bin/thinktank daemon
   Restart=always
   RestartSec=30
   NoNewPrivileges=true
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```
   `/etc/systemd/system/thinktank-web.service`: same, with
   `ExecStart=/home/thinktank/thinktank/.venv/bin/thinktank web`.
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now thinktank-web thinktank-daemon
   journalctl -u thinktank-daemon -f
   ```
4. Backup timer. Nightly copy of the database with SQLite's own backup:
   `/etc/systemd/system/thinktank-backup.service` runs
   `sqlite3 /home/thinktank/thinktank/data/thinktank.sqlite3 ".backup /home/thinktank/backups/thinktank-$(date +%F).sqlite3"`
   and a `.timer` with `OnCalendar=*-*-* 07:30`. Keep 30 days. Copy the
   backups folder off the box weekly; the claim ledger is the asset.
5. Smoke test in the foreground, with a low ceiling, on a throwaway problem:
   ```bash
   cat > /tmp/smoke.json <<'EOF'
   {"mode":"research","question":"Which public broadcasters in the Netherlands publish their annual report online?","decision":"smoke test only","must_answer":["Broadcasters","Report URLs","Publication year"],"evidence_standard":"Primary sources, the broadcaster's own site","deliverable":"one-page list","deadline":"23:59"}
   EOF
   THINKTANK_MAX_USD_PER_RUN=1.0 thinktank post /tmp/smoke.json
   THINKTANK_MAX_USD_PER_RUN=1.0 thinktank run <problem id>
   ```
   While it runs, open the problem page: readers appear in the agent index,
   the fetch log fills, notes get `quote_check` pass or fail, the critic
   verifies, the feed shows any messages.

**Exit test:** the smoke problem reaches `passed` or a clean `escalated`
with a reason you understand, at least one note shows `quote_check = pass`
on a real page, and `thinktank status` shows the spend. Then reboot the box
and confirm both services come back and the daemon logs `recover`.

If the verifier shows `fetch failed` on every URL, the box's outbound HTTPS
is blocked or a proxy is in the way. Fix that before anything else.

---

## Day 3 (Wed): the baseline

**Goal:** the number the think tank has to beat.

1. Write your next three real problems in the template
   (`docs/baseline-template.md`). Real questions you would act on, public
   topics, 3 to 7 must-answer items, a deliverable shape, a deadline of
   `07:00`.
2. Run each through the built-in Research feature in the Claude app by
   hand. Keep the outputs.
3. Spot-check 10 claims per output against their sources. A claim with no
   source counts as wrong. Fill the baseline table: error rate, must-answer
   coverage, your minutes.
4. Post the same three problems to the inbox board. They queue for the
   run window tonight. Before bed: read the plan's usage page and write the
   percentage down. This is calibration reading one.

**Exit test:** three baseline rows filled in, three problems `queued`, one
usage percentage noted.

---

## Day 4 (Thu): first morning after

**Goal:** the first honest comparison, and the first calibration number.

1. Read the usage page again. Tokens the board reports for the night
   divided by the percentage points consumed is your tokens-per-point.
   Write it in the baseline file. This is the only way to know what a
   problem costs you in plan terms.
2. For each reply: spot-check 10 claims exactly as you did for the
   baseline. Same method, same count, no favours. Record error rate,
   coverage, your minutes.
3. Read each problem page top to bottom:
   - Fetch log: 403s and `unsupported` pages tell you which sources the
     verifier cannot read. PDFs are expected; a whole domain refusing is a
     user-agent problem to raise with me.
   - Feed: did readers ask each other useful things, or nothing? Did the
     critic's objections lead to better notes? Any thread closed on budget?
   - Escalations: read the partial; the reason tells you whether it was a
     cap, a deadline, a judge fail, or an agent that produced nothing.
4. Fix what is cheap: a prompt line, a topic tag habit, a model tier. Do
   not redesign after one night.

**Exit test:** a table with baseline and think-tank rows side by side for
three problems, and one tokens-per-point figure.

---

## Day 5 (Fri): ideas mode and the second wave

**Goal:** the other half of the system, and two more research problems queued.

1. Write one ideas problem (a real strategy question, 3 to 7 must-answer
   items, deliverable "ranked options with the assumption each depends
   on"). Post it, plus two more research problems. They run tonight.
2. Saturday morning, read the ideas problem's feed first: three thinkers
   born, premortems, repairs, then the combine round. Rate the reply on
   the doc's own metric: does it contain an option you had not considered?
3. Spot-check the two research replies as before. Second calibration
   reading.

**Exit test:** five research and one ideas problem through the system,
each with a spot-check row.

---

## Day 6 and 7 (Sat, Sun): steady state

**Goal:** the box runs without you, and you know when to stop it.

1. Restore test: copy a backup to a temp path, run
   `thinktank --db /tmp/restore.sqlite3 status`. If that does not print
   your problems, the backups are worthless.
2. Disk: `du -sh data/agents ~/.claude/projects`. Agent sessions are deleted
   at problem close; anything left belongs to problems that escalated
   mid-flight or a crashed run. Safe to delete for closed problems.
3. Purge any source the spot-checks caught lying:
   `thinktank purge https://bad.example/`.
4. Decide, with the table in front of you:
   - Claims surviving spot-check clearly above baseline and at or above 95
     percent: continue; queue next week's problems.
   - Not above baseline after six problems: the doc's kill criterion
     applies. Stop the daemon, keep the ledger, use the built-in feature.
   - In between: one more week, and change one thing at a time.

**Exit test:** a written go, stop or one-more-week decision, and next
week's problems posted.

---

## Operations card

Keep this near the SSH window.

| Need | Command |
|------|---------|
| Is it alive | `systemctl status thinktank-daemon thinktank-web` |
| What is it doing | `journalctl -u thinktank-daemon -f` |
| Spend and problems | `thinktank status` |
| Run one problem now, ignoring the window | `thinktank run <id>` (stop the daemon first, or it will run the same queue) |
| Post from a file | `thinktank post problem.json` |
| Purge a bad source | `thinktank purge https://domain/` |
| Rotate the token (expired or leaked) | `claude setup-token`, update `/etc/thinktank.env`, `systemctl restart thinktank-daemon` |
| Update the code | `git pull && pip install -e . && python -m pytest -q && systemctl restart thinktank-daemon thinktank-web` |
| Update Claude Code | `claude install stable` then a Day 1 exit test |

Failure playbook:

- **Problem sits in `queued` with `not_before` set**: a rate-limit response.
  The daemon retries after `rate_limit_pause_seconds`. Nothing to do.
- **Problem `escalated: no reader produced a single note`**: readers ran
  but posted nothing. Open a reader's run row: an `error` column with
  "not found" means the ledger MCP server failed to start (wrong
  `PYTHONPATH` or venv); "usage limit" means the plan is exhausted.
- **Every note `quote_check = fail` with `fetch failed`**: outbound HTTPS
  from the box is broken. `curl -I https://example.com` from the box.
- **Thread closed on budget on the first night**: read it. If it is two
  agents genuinely arguing, that is the design working; if it is noise,
  lower `thread_token_budget` for a week.
- **Daemon restarts in a loop**: `journalctl -u thinktank-daemon -n 50`.
  A traceback in the ledger is a bug for me; a permissions error on
  `data/` is `chown -R thinktank:thinktank data`.
- **Board unreachable from the phone**: `web_host` must be the address the
  phone can route to (Tailscale IP or LAN IP), not `127.0.0.1`.

Security card, once, on Day 1: no other repositories, SSH keys, cloud
credentials or mounted drives on this box; SSH agent forwarding off in your
laptop's config for this host; the token file is mode 600; the board port
is never forwarded through the router. If the box ever needs a rescue and
you still have no keyboard, path A is also the rescue path: pull the SSD,
mount it on the laptop, fix, put it back.

A convenience for the laptop, in `~/.ssh/config`:
```
Host thinktank
    HostName thinktank.local
    User thinktank
    IdentityFile ~/.ssh/thinktank
    ForwardAgent no
```

---

## What I need from you during the week

- Day 2: if the smoke test's fetch log shows a domain refusing the
  verifier, send me the URL and the detail column; that is a user-agent or
  redirect case I can handle in `verify.py`.
- Day 4: the first tokens-per-point figure and the feed of one problem. That
  is enough to tune routing and the wake prompt.
- Any traceback from the journal, verbatim.
