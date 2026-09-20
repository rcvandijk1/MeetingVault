# Build week: Nightwatch on a headless mini PC

The code is built and tested. This week turns it into a running department
on a box of its own, measures the baseline it has to beat, and runs the
first real problems. Each day ends with an exit test. Do not start the next
day until the exit test passes; the days are ordered so that a failure
early costs an hour, not a night of tokens.

The system's name is Nightwatch: it works at night, watches sources, and
tells you in the morning what it found. It is one line in the config
(`system_name`) if you want another. The Python package stays `thinktank`.

Assumptions: a mini PC with 8 GB RAM and 64 GB of disk or more, already
installed; a keyboard, mouse and monitor you can plug in once for setup
and then take away; your Claude Max subscription; a laptop on the same
network; a phone you may want to read the board from. After setup the box
has only power and Ethernet. Nothing else runs on it. Ever.

---

## Day 1 (Mon): the box

**Goal:** a clean, locked-down machine you reach only over SSH, that can
run one headless Claude call.

Plug the peripherals in for this day only.

1. **Operating system.** If the box runs Ubuntu or Debian, keep it. If it
   runs Windows, install Ubuntu Server 24.04 over it now, while you have a
   screen: the box must run nothing else, and Windows plus WSL is not
   nothing else. The installer takes fifteen minutes; choose "OpenSSH
   server" when asked, hostname `nightwatch`, user `nightwatch`.
2. **SSH from the laptop, keys only.** On the laptop:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/nightwatch -C nightwatch
   ssh-copy-id -i ~/.ssh/nightwatch.pub nightwatch@<box ip>
   ```
   On the box, then:
   ```bash
   sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   sudo systemctl restart ssh
   ```
   Laptop `~/.ssh/config`, so the rest of the week is `ssh nightwatch`:
   ```
   Host nightwatch
       HostName nightwatch.local
       User nightwatch
       IdentityFile ~/.ssh/nightwatch
       ForwardAgent no
   ```
3. **Name resolution and a fixed address.** `sudo apt install -y avahi-daemon`
   makes `nightwatch.local` work on the LAN. Also give the box a DHCP
   reservation in your router so its IP never changes; the board's
   `web_host` on Day 2 depends on it.
4. **Firewall, updates, time zone, packages.**
   ```bash
   sudo apt update && sudo apt install -y ufw unattended-upgrades git python3 python3-venv python3-pip sqlite3 curl
   sudo ufw default deny incoming && sudo ufw default allow outgoing
   sudo ufw allow from 192.168.0.0/16 to any port 22     # your LAN range
   sudo ufw --force enable
   sudo timedatectl set-timezone Europe/Amsterdam        # the run window is local time
   ```
5. **Confirm you can get in without the screen.** From the laptop:
   `ssh nightwatch` and `sudo -n true`. If both work, unplug the keyboard,
   mouse and monitor. They do not come back. Everything below is over SSH.
6. **Claude Code.** Native installer first; npm as the fallback.
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash        # native build, no Node needed
   # fallback: install Node 22 (nodesource) then: npm install -g @anthropic-ai/claude-code
   claude --version
   ```
7. **Headless login.** A box without a browser uses a long-lived token,
   created inside your SSH session:
   ```bash
   claude setup-token
   ```
   It prints a URL. Open that URL in the browser on your laptop, approve
   with your Claude account, paste the code it gives you back into the SSH
   session. Put the token it prints where the services will read it:
   ```bash
   sudo install -m 600 -o nightwatch -g nightwatch /dev/null /etc/nightwatch.env
   echo 'CLAUDE_CODE_OAUTH_TOKEN=<paste>' | sudo tee /etc/nightwatch.env >/dev/null
   ```
   Never put an `ANTHROPIC_API_KEY` on this box while `auth_mode` is
   subscription; the runner strips it anyway.
8. **Clone and test.**
   ```bash
   git clone <your repo url> ~/nightwatch && cd ~/nightwatch
   git checkout claude/artifact-build-dw4ib9        # or main once merged
   python3 -m venv .venv && . .venv/bin/activate
   pip install -e ".[dev]"
   python -m pytest -q                               # expect 61 passed
   ```

**Exit test:**
```bash
set -a; . /etc/nightwatch.env; set +a
claude -p "Reply with the single word OK" --model haiku --tools "" --output-format json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['result'],d['total_cost_usd'])"
```
prints `OK` and a cost below a cent, over SSH, with nothing but power and
Ethernet in the box. If it asks you to log in, the token is not in the
environment.

---

## Day 2 (Tue): the service, and the tab that tells you

**Goal:** daemon and board run under systemd, survive a reboot, and a
pinned tab on your laptop tells you when Nightwatch needs you.

1. **Config.** Copy and edit; absolute paths, the box's fixed address:
   ```bash
   cp thinktank.example.toml thinktank.toml
   ```
   ```toml
   system_name = "Nightwatch"
   db_path = "/home/nightwatch/nightwatch/data/thinktank.sqlite3"
   agent_dir = "/home/nightwatch/nightwatch/data/agents"
   auth_mode = "subscription"
   run_window = "22:00-07:00"
   spend_max_usd_month = 100.0
   max_usd_per_run = 8.0
   web_host = "192.168.1.50"      # the box's fixed LAN address, or its Tailscale IP
   web_port = 8765
   [models]
   reader = "haiku"
   thinker = "opus"
   critic = "sonnet"
   synthesizer = "opus"
   judge = "sonnet"
   ```
   `mkdir -p data && thinktank init`
2. **Reaching the board.** Two options; the second gives you the phone and
   desktop notifications for free.
   - LAN only: `sudo ufw allow from 192.168.0.0/16 to any port 8765`,
     `web_host` = the LAN address. The tab badge works; desktop
     notifications do not, because browsers only allow them on https.
   - Tailscale (recommended): install Tailscale on the box, laptop and
     phone; set `web_host` to the box's Tailscale IP; do not open the port
     on the LAN at all. Then `sudo tailscale serve --bg https+insecure://localhost:8765`
     gives you `https://nightwatch.<your tailnet>.ts.net` with a real
     certificate, from anywhere, and desktop notifications work.
   The board has no login; never expose it beyond one of these.
3. **systemd units.** `/etc/systemd/system/nightwatch-daemon.service`:
   ```ini
   [Unit]
   Description=Nightwatch supervisor
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=nightwatch
   WorkingDirectory=/home/nightwatch/nightwatch
   EnvironmentFile=/etc/nightwatch.env
   Environment=THINKTANK_CONFIG=/home/nightwatch/nightwatch/thinktank.toml
   ExecStart=/home/nightwatch/nightwatch/.venv/bin/thinktank daemon
   Restart=always
   RestartSec=30
   NoNewPrivileges=true
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```
   `/etc/systemd/system/nightwatch-web.service`: same, with
   `Description=Nightwatch board` and
   `ExecStart=/home/nightwatch/nightwatch/.venv/bin/thinktank web`.
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now nightwatch-web nightwatch-daemon
   journalctl -u nightwatch-daemon -f
   ```
4. **The tab.** On the laptop open the board's reply page
   (`/replies`), pin the tab. Its title shows `(2) Nightwatch` when two
   things need you; the favicon turns red with the count, amber when the
   supervisor's heartbeat stops. At the top of every page a banner says
   what the supervisor is doing, what is queued, and lists what needs you:
   unread replies, open escalations, a dead supervisor. Click "enable
   desktop notifications" in that banner once (works on https or
   localhost) and you also get a system notification when the count rises.
   Opening a reply marks it read; "Mark all as read" clears the rest;
   resolving an escalation clears it. Nothing is pushed off the box: the
   tab asks every 30 seconds.
5. **Backup timer.** Nightly copy of the database with SQLite's own backup:
   `/etc/systemd/system/nightwatch-backup.service` runs
   `sqlite3 /home/nightwatch/nightwatch/data/thinktank.sqlite3 ".backup /home/nightwatch/backups/thinktank-$(date +%F).sqlite3"`
   and a `.timer` with `OnCalendar=*-*-* 07:30`. Keep 30 days. Copy the
   backups folder off the box weekly; the claim ledger is the asset.
6. **Smoke test** in the foreground, with a low ceiling, on a throwaway
   problem. Stop the daemon first so it does not take the same problem:
   ```bash
   sudo systemctl stop nightwatch-daemon
   cat > /tmp/smoke.json <<'EOF'
   {"mode":"research","question":"Which public broadcasters in the Netherlands publish their annual report online?","decision":"smoke test only","must_answer":["Broadcasters","Report URLs","Publication year"],"evidence_standard":"Primary sources, the broadcaster's own site","deliverable":"one-page list","deadline":"23:59"}
   EOF
   set -a; . /etc/nightwatch.env; set +a
   THINKTANK_MAX_USD_PER_RUN=1.0 thinktank post /tmp/smoke.json
   THINKTANK_MAX_USD_PER_RUN=1.0 thinktank run <problem id>
   sudo systemctl start nightwatch-daemon
   ```
   While it runs, watch the problem page: readers appear in the agent
   index, the fetch log fills, notes get `quote_check` pass or fail, the
   critic verifies, the feed shows any messages. When it finishes, the
   pinned tab should read `(1) Nightwatch`.

**Exit test:** the smoke problem reaches `passed` or a clean `escalated`
with a reason you understand; at least one note shows `quote_check = pass`
on a real page; the pinned tab badge appeared and cleared when you opened
the reply. Then reboot the box and confirm both services come back, the
banner shows the supervisor alive, and the daemon logs `recover`.

If the verifier shows `fetch failed` on every URL, the box's outbound HTTPS
is blocked or a proxy is in the way. Fix that before anything else.

---

## Day 3 (Wed): the baseline

**Goal:** the number Nightwatch has to beat.

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

The pinned tab tells you before you look: `(3) Nightwatch` means three
replies, `(2)` with an amber favicon means one escalated and the supervisor
is idle outside the window, which is normal at 08:00.

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

**Exit test:** a table with baseline and Nightwatch rows side by side for
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
4. Optional, phone notifications without an open tab: install `ntfy`
   server on the box (one binary, LAN or Tailscale only), the ntfy app on
   the phone, and a two-line cron on the box that posts to it when
   `thinktank status --json` shows unread replies. This stays inside your
   network; it is not the external write channel the design forbids. Ask
   me and I will add a `thinktank notify` command that does exactly this.
5. Decide, with the table in front of you:
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
| Is it alive | `systemctl status nightwatch-daemon nightwatch-web`, or the banner on any board page |
| What is it doing | `journalctl -u nightwatch-daemon -f` |
| Spend and problems | `thinktank status` |
| Run one problem now, ignoring the window | `systemctl stop nightwatch-daemon`, `thinktank run <id>`, `systemctl start nightwatch-daemon` |
| Post from a file | `thinktank post problem.json` |
| Purge a bad source | `thinktank purge https://domain/` |
| Rotate the token (expired or leaked) | `claude setup-token`, update `/etc/nightwatch.env`, `systemctl restart nightwatch-daemon` |
| Update the code | `git pull && pip install -e . && python -m pytest -q && systemctl restart nightwatch-daemon nightwatch-web` |
| Update Claude Code | `claude install stable` then the Day 1 exit test |

Failure playbook:

- **Banner says supervisor not running, `(down) Nightwatch` in the tab**:
  `systemctl status nightwatch-daemon`. If it is running but the heartbeat
  is stale, the database is locked or full; `journalctl` will say.
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
- **Daemon restarts in a loop**: `journalctl -u nightwatch-daemon -n 50`.
  A traceback in the ledger is a bug for me; a permissions error on
  `data/` is `chown -R nightwatch:nightwatch data`.
- **Board unreachable from the laptop or phone**: `web_host` must be the
  address they can route to (Tailscale IP or LAN IP), not `127.0.0.1`.
- **No desktop notification although the badge changes**: the page is on
  plain http. Use Tailscale Serve, or accept the badge.

Security card, once, on Day 1: no other repositories, SSH keys, cloud
credentials or mounted drives on this box; SSH agent forwarding off in your
laptop's config for this host; the token file is mode 600; the board port
is never forwarded through the router. If SSH ever stops answering and the
box has no screen, plug the monitor and keyboard back in for that one
repair; that is the only exception.

---

## What I need from you during the week

- Day 2: if the smoke test's fetch log shows a domain refusing the
  verifier, send me the URL and the detail column; that is a user-agent or
  redirect case I can handle in `verify.py`.
- Day 4: the first tokens-per-point figure and the feed of one problem. That
  is enough to tune routing and the wake prompt.
- Any traceback from the journal, verbatim.
