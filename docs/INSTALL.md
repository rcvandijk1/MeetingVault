# Nightwatch: build day and install day

Two days. The build day happens on your laptop and prepares everything the
box will need, so the install day is mostly copying and switching on. Each
day ends with an exit test. After that, a short list of what to check after
the first nights.

Assumptions: a mini PC with 8 GB RAM and 64 GB of disk or more, already
installed; a keyboard, mouse and monitor you can plug in once and take
away; your Claude Max subscription; a laptop on the same network. After
install the box has only power and Ethernet. Nothing else runs on it. Ever.

The system's name is Nightwatch (`system_name` in the config; the Python
package stays `thinktank`).

---

## Build day (laptop)

**Goal:** a tested checkout, a finished config, the service files, and the
first problems written, all sitting in one folder ready to copy.

1. **Clone and test.**
   ```bash
   git clone <your repo url> nightwatch && cd nightwatch
   git checkout claude/artifact-build-dw4ib9        # or main once merged
   python3 -m venv .venv && . .venv/bin/activate    # Python 3.11 or newer
   pip install -e ".[dev]"
   python -m pytest -q                               # expect 61 passed
   ```
2. **Try the board locally**, so you know what you are looking at on the box:
   ```bash
   thinktank --db /tmp/try.sqlite3 init
   thinktank --db /tmp/try.sqlite3 web               # http://127.0.0.1:8765/
   ```
   Post a throwaway problem in the form, open its page, look at the banner
   (it says the supervisor is not running: correct, nothing is running).
   Ctrl-C.
3. **Write the config** the box will use. Absolute paths on the box, its
   future fixed address:
   ```bash
   cp thinktank.example.toml deploy/thinktank.toml
   ```
   ```toml
   system_name = "Nightwatch"
   db_path = "/home/nightwatch/nightwatch/data/thinktank.sqlite3"
   agent_dir = "/home/nightwatch/nightwatch/data/agents"
   auth_mode = "subscription"
   run_window = "22:00-07:00"
   spend_max_usd_month = 100.0
   max_usd_per_run = 8.0
   web_host = "192.168.1.50"      # the address you will reserve for the box in the router
   web_port = 8765
   [models]
   reader = "haiku"
   thinker = "opus"
   critic = "sonnet"
   synthesizer = "opus"
   judge = "sonnet"
   ```
4. **Write the service files** into `deploy/`:

   `deploy/nightwatch-daemon.service`
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
   `deploy/nightwatch-web.service`: the same with `Description=Nightwatch board`
   and `ExecStart=/home/nightwatch/nightwatch/.venv/bin/thinktank web`.

   `deploy/nightwatch-backup.service`
   ```ini
   [Unit]
   Description=Nightwatch database backup

   [Service]
   Type=oneshot
   User=nightwatch
   ExecStart=/bin/sh -c 'mkdir -p /home/nightwatch/backups && sqlite3 /home/nightwatch/nightwatch/data/thinktank.sqlite3 ".backup /home/nightwatch/backups/thinktank-$(date +%%F).sqlite3" && find /home/nightwatch/backups -name "thinktank-*.sqlite3" -mtime +30 -delete'
   ```
   `deploy/nightwatch-backup.timer`
   ```ini
   [Unit]
   Description=Nightly Nightwatch backup

   [Timer]
   OnCalendar=*-*-* 07:30
   Persistent=true

   [Install]
   WantedBy=timers.target
   ```
5. **An SSH key for the box**, kept on the laptop only:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/nightwatch -C nightwatch
   ```
   and in `~/.ssh/config`:
   ```
   Host nightwatch
       HostName nightwatch.local
       User nightwatch
       IdentityFile ~/.ssh/nightwatch
       ForwardAgent no
   ```
6. **Write the first problems** while you are at the laptop anyway. Three
   real research questions in the post template
   (`docs/baseline-template.md`): public topics, 3 to 7 must-answer items,
   a deliverable shape, deadline `07:00`. Save them as `deploy/p1.json`,
   `p2.json`, `p3.json` (fields: `mode`, `question`, `decision`,
   `must_answer`, `evidence_standard`, `deliverable`, `deadline`). Plus one
   throwaway smoke problem:
   ```json
   {"mode":"research","question":"Which public broadcasters in the Netherlands publish their annual report online?","decision":"smoke test only","must_answer":["Broadcasters","Report URLs","Publication year"],"evidence_standard":"Primary sources, the broadcaster's own site","deliverable":"one-page list","deadline":"23:59"}
   ```
7. **Baseline, if you have the time today.** Run the three real problems
   through the built-in Research feature in the Claude app by hand, keep
   the outputs, spot-check 10 claims each against their sources, fill the
   table in `docs/baseline-template.md`. This is the number Nightwatch has
   to beat. If not today, do it before the first real night.
8. If the box runs Windows: download the Ubuntu Server 24.04 ISO and write
   it to a USB stick now (Rufus or balenaEtcher). The box must run nothing
   else, and Windows plus WSL is not nothing else.

**Exit test:** `python -m pytest -q` passes, `deploy/` holds the config,
four unit files, the smoke problem and three real problems, and
`ssh-add -L` does not list the nightwatch key (it stays a file, no agent).

---

## Install day (box)

**Goal:** the box runs Nightwatch under systemd with only power and
Ethernet attached, and a pinned tab on the laptop tells you when it needs you.

Plug the keyboard, mouse and monitor in for steps 1 to 4 only.

1. **Operating system.** Linux already there: keep it. Windows: boot the
   USB stick and install Ubuntu Server 24.04 over it, ticking "OpenSSH
   server", hostname `nightwatch`, user `nightwatch`. Fifteen minutes.
2. **Network.** Note the box's IP. In your router, reserve that address
   for it (DHCP reservation) so `web_host` in the config stays valid.
3. **SSH keys only, and a name.**
   ```bash
   sudo apt update && sudo apt install -y avahi-daemon ufw unattended-upgrades git python3 python3-venv python3-pip sqlite3 curl
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   # paste the laptop's ~/.ssh/nightwatch.pub into ~/.ssh/authorized_keys, then:
   chmod 600 ~/.ssh/authorized_keys
   sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   sudo systemctl restart ssh
   sudo ufw default deny incoming && sudo ufw default allow outgoing
   sudo ufw allow from 192.168.0.0/16 to any port 22      # your LAN range
   sudo ufw allow from 192.168.0.0/16 to any port 8765
   sudo ufw --force enable
   sudo timedatectl set-timezone Europe/Amsterdam          # the run window is local time
   ```
4. **Prove you can get in blind.** From the laptop: `ssh nightwatch` and
   `sudo -n true`. Both work: unplug the keyboard, mouse and monitor. They
   do not come back. Everything below is over SSH from the laptop.
5. **Claude Code and the headless login.**
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash        # native build; fallback: npm install -g @anthropic-ai/claude-code
   claude --version
   claude setup-token
   ```
   `setup-token` prints a URL. Open it in the laptop's browser, approve
   with your Claude account, paste the code back into the SSH session. Put
   the token it prints where the services read it:
   ```bash
   sudo install -m 600 -o nightwatch -g nightwatch /dev/null /etc/nightwatch.env
   echo 'CLAUDE_CODE_OAUTH_TOKEN=<paste>' | sudo tee /etc/nightwatch.env >/dev/null
   set -a; . /etc/nightwatch.env; set +a
   claude -p "Reply with the single word OK" --model haiku --tools "" --output-format json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['result'],d['total_cost_usd'])"
   ```
   Expect `OK` and a cost below a cent. Never put an `ANTHROPIC_API_KEY`
   on this box.
6. **Copy the build.** From the laptop:
   ```bash
   scp -r nightwatch nightwatch:~/nightwatch     # or git clone on the box and scp only deploy/
   ```
   On the box:
   ```bash
   cd ~/nightwatch && python3 -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
   python -m pytest -q                            # 61 passed, on the box this time
   cp deploy/thinktank.toml thinktank.toml && mkdir -p data && thinktank init
   sudo cp deploy/nightwatch-*.service deploy/nightwatch-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now nightwatch-web nightwatch-backup.timer
   ```
   Leave the daemon off for the smoke test.
7. **Smoke test**, foreground, one-dollar ceiling per run:
   ```bash
   set -a; . /etc/nightwatch.env; set +a
   THINKTANK_MAX_USD_PER_RUN=1.0 thinktank post deploy/smoke.json
   THINKTANK_MAX_USD_PER_RUN=1.0 thinktank run <problem id>
   ```
   Meanwhile, on the laptop, open `http://192.168.1.50:8765/replies`, pin
   the tab, and watch the problem page: readers in the agent index, the
   fetch log filling, notes getting `quote_check` pass or fail, the critic
   verifying, any messages in the feed. When it finishes the tab reads
   `(1) Nightwatch`; open the reply and it clears.

   If every URL shows `fetch failed`, outbound HTTPS from the box is
   blocked; fix that before anything else.
8. **Switch the daemon on and post the real problems.**
   ```bash
   sudo systemctl enable --now nightwatch-daemon
   for f in deploy/p1.json deploy/p2.json deploy/p3.json; do thinktank post $f; done
   journalctl -u nightwatch-daemon -f
   ```
   The banner on the board now says the supervisor is idle or outside the
   run window, with three queued. They run tonight.
9. **Notifications and the phone, optional today.** Browsers allow desktop
   notifications only on https or localhost; the badge and banner work on
   plain http. For https and phone access from anywhere, install Tailscale
   on the box, laptop and phone, set `web_host` to the box's Tailscale IP,
   remove the LAN rule for 8765, restart the web service, and run
   `sudo tailscale serve --bg https+insecure://localhost:8765`. Then click
   "enable desktop notifications" in the banner once.
10. **Reboot test.** `sudo reboot`, wait a minute, `ssh nightwatch`,
    `systemctl status nightwatch-daemon nightwatch-web`, and the banner
    shows the supervisor alive. The journal shows `recover` on start.

Before bed: read the plan's usage page and write the percentage down.
That is calibration reading one.

**Exit test:** three problems queued, both services green after a reboot,
the pinned tab alive on the laptop, nothing but power and Ethernet in the box.

---

## After the first nights

The pinned tab tells you before you look: `(3) Nightwatch` is three
replies; an amber favicon is a stopped supervisor, normal only if you
stopped it.

- **Calibration.** Usage page again in the morning. Tokens the board
  reports for the night divided by percentage points consumed is your
  tokens-per-point. Write it in the baseline file. Repeat monthly.
- **Spot-check every reply** the same way as the baseline: 10 claims,
  same method, no favours. Record error rate, coverage, your minutes,
  next to the baseline row.
- **Read one problem page top to bottom.** Fetch log: domains refusing the
  verifier, PDFs marked unsupported. Feed: did agents ask each other useful
  things, did a critic objection lead to a better note, any thread closed
  on budget. Escalations: the reason says whether it was a deadline, a
  judge fail, or an agent that produced nothing.
- **Run one ideas problem** in the first week and rate its reply on the
  doc's own metric: does it contain an option you had not considered?
- **Housekeeping, weekly.** Restore a backup to a temp path and run
  `thinktank --db /tmp/restore.sqlite3 status`; `du -sh data/agents
  ~/.claude/projects`; `thinktank purge https://bad.example/` for any
  source a spot-check caught lying; copy the backups folder off the box.
- **Decide after six problems**, with the table in front of you. Clearly
  above baseline and at or above 95 percent surviving claims: continue.
  Not above baseline: the design's kill criterion applies, stop the daemon,
  keep the ledger. In between: one more week, one change at a time.

---

## Operations card

| Need | Command |
|------|---------|
| Is it alive | the banner on any board page, or `systemctl status nightwatch-daemon nightwatch-web` |
| What is it doing | `journalctl -u nightwatch-daemon -f` |
| Spend and problems | `thinktank status` |
| Run one problem now, ignoring the window | `sudo systemctl stop nightwatch-daemon`, `thinktank run <id>`, `sudo systemctl start nightwatch-daemon` |
| Post from a file | `thinktank post problem.json` |
| Purge a bad source | `thinktank purge https://domain/` |
| Rotate the token | `claude setup-token`, update `/etc/nightwatch.env`, `sudo systemctl restart nightwatch-daemon` |
| Update the code | `git pull && pip install -e . && python -m pytest -q && sudo systemctl restart nightwatch-daemon nightwatch-web` |
| Update Claude Code | `claude install stable`, then the step 5 check |

Failure playbook:

- **`(down) Nightwatch` in the tab**: `systemctl status nightwatch-daemon`.
  Running but stale heartbeat means the database is locked or the disk is
  full; the journal will say.
- **Problem in `queued` with `not_before` set**: a rate-limit response; the
  daemon retries after the pause. Nothing to do.
- **`escalated: no reader produced a single note`**: open a reader's run
  row. "not found" in the error means the ledger MCP server failed to start
  (venv or `PYTHONPATH`); "usage limit" means the plan is exhausted.
- **Every note `quote_check = fail` with `fetch failed`**: outbound HTTPS
  broken; `curl -I https://example.com` from the box.
- **Thread closed on budget**: read it. Genuine argument is the design
  working; noise means lower `thread_token_budget` for a week.
- **Daemon restart loop**: `journalctl -u nightwatch-daemon -n 50`. A
  traceback is a bug for me; a permissions error is
  `chown -R nightwatch:nightwatch data`.
- **Board unreachable**: `web_host` must be the address the laptop can
  route to, not `127.0.0.1`.
- **SSH stops answering**: the one exception to the no-screen rule. Plug
  the monitor and keyboard back in for that repair.

Security, once: no other repositories, SSH keys, cloud credentials or
mounted drives on the box; agent forwarding off for this host; the token
file mode 600; port 8765 never forwarded through the router.

---

## What I need from you

- From the smoke test: any domain the verifier could not read (URL and the
  detail column). That is a user-agent or redirect case for `verify.py`.
- From the first night: the tokens-per-point figure and one problem's feed.
  Enough to tune routing and the wake prompt.
- Any traceback from the journal, verbatim.
