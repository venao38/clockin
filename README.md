# Clock-in'

A self-hosted, open-source **time tracker** with tasks, timesheets and invoices on one screen. One-click
timer, totals by client and project, CSV export, and month-end invoices. No account, no subscription: it runs
on your own computer. Built by a freelancer, for anyone who tracks their time.

![Clock-in' with a timer running, the Navigator, a project's tasks and its timesheet](docs/screenshot-light.png)

## Why I built Clock-in'

I'm a freelance illustrator, video editor and graphic designer, and I make my own artwork too. I work for a
few clients at once, and most of them pay me by the hour. For years my day looked like this: a to-do app in
one window, a timer in another, a spreadsheet at the end of the month, and a scramble to rebuild what I did
on the 14th.

Clock-in' puts all of that on one screen.

**Start the clock from the work itself.** Every task has a ▶ button. Press it and the timer starts with the
right client and project already filled in. When I switch jobs, I press ▶ on the next task. There's nothing to
copy across and nothing to forget. If I do forget, the timer stops itself after 8 hours and flags the entry so
I can fix it.

**One list per client, one view for today.** The sidebar holds my clients and their projects. Click one and
everything narrows to it: the tasks, the hours, the week chart. "Now" shows everything that's open across all
of them. Repeating jobs, like a weekly social post or a monthly video, come back on their own. If I miss one,
it waits for me instead of quietly disappearing.

**Month-end in one click.** On the 1st, I open the Timesheet, pick the client and press **Invoice**. I get a
ZIP with:

- a timesheet spreadsheet of every entry;
- a clean PDF invoice with my details, the client's address and the total;
- the email text, ready to paste.

The hours on the invoice match the hours I actually tracked, because they're the same data.

**Not everything is billable.** My personal artwork and fixed-fee jobs don't get a rate, so they never show
dollars or an Invoice button. They're tracked in hours so I can still see where my time goes.

**My data stays mine.** It runs on my own computer, with no account and no subscription, and everything is
saved as plain files I can back up or open myself. I keep it running on a small always-on Mac at home and open
it from my laptop, but it works just as well on a single machine.

**Make the screen fit the day.** Planning gets a big task list. Tracking gets a slim window with just the clock.
Month-end gets a wide timesheet. Every panel can be dragged, stacked or folded away.

If you bill by the hour, juggle more than one client, and want your tasks and your timesheet to stop living in
different places, this is the tool I wished I'd had.

## Coming from another time tracker?

If you've used Toggl Track, Clockify or Harvest, the core will feel familiar:

| | Clock-in' |
|---|---|
| Timer | One click from any task or preset, or type and press Enter. One timer at a time, always visible. |
| Timesheet | Every entry for a week, a month or all time; add and edit entries by hand. |
| Totals | By client and by project, including the timer that's running right now. |
| Week view | A day-by-day chart of your tracked time, coloured by project. |
| Export | CSV, plus a spreadsheet timesheet with each invoice. |
| Invoices | PDF invoice and email text from the hours, for clients with a rate. Optional. |
| Tasks | Built in: projects, subtasks, due dates, repeating tasks. |
| Your data | Plain JSON files on your computer, with rolling backups. No account, no cloud. |

What it doesn't do (yet): there's no phone app, no team accounts or shared workspaces, and no cloud sync.
You can still reach it from other devices on your home network, without a login, so only on a network you trust.

| Dark | First-run tour |
|---|---|
| ![Dark mode](docs/screenshot-dark.png) | ![The welcome card of the tour](docs/screenshot-tour.png) |

## Get started

You need **Python 3.9 or newer**. On a Mac, open Terminal and type `python3 --version`; if it isn't there,
macOS offers to install it (or get it from [python.org](https://www.python.org/downloads/)).

1. **Get the code**: `git clone` this repository, or use the green **Code → Download ZIP** button and unzip it.
2. **Install** (once), inside the `clockin` folder:

   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

3. **Run it**, then open <http://127.0.0.1:5002> in your browser:

   ```bash
   .venv/bin/python run.py
   ```

   It runs while that Terminal window is open; press `Ctrl+C` to stop it.
   Want something to look at first? `.venv/bin/python tools/seed_demo.py ./data` adds demo data (run it
   before your first real use; it won't overwrite existing files).

### Start it automatically (Mac)

So you don't need Terminal every time, let macOS start Clock-in' when you log in. Save this as
`~/Library/LaunchAgents/com.clockin.plist`, replacing both `/path/to/clockin` with the real folder:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.clockin</string>
  <key>ProgramArguments</key>
  <array><string>/path/to/clockin/.venv/bin/python</string><string>/path/to/clockin/run.py</string></array>
  <key>WorkingDirectory</key><string>/path/to/clockin</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

Then turn it on (and later, off) with:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.clockin.plist
launchctl bootout gui/$(id -u)/com.clockin
```

On Linux a systemd user service does the same job; on Windows, Task Scheduler with "At log on".

## Your data

Your data lives in `CLOCKIN_DATA_DIR` (default `./data`): `entries.json`, `clients.json`, `projects.json`,
`tasks.json`, `presets.json` and the running `.timer.json`. Every write takes a file lock, keeps a rolling
backup in `data/backups/rolling/` (newest 50 per file) and refuses to silently drop records.

| Environment variable | Default | |
|---|---|---|
| `CLOCKIN_DATA_DIR` | `./data` | where your files live |
| `CLOCKIN_HOST` / `CLOCKIN_PORT` | `127.0.0.1` / `5002` | use `0.0.0.0` to reach it from another machine on your network (there's no login, so only do this on a network you trust) |
| `CLOCKIN_SETTINGS` | `<data dir>/settings.json` | see `settings.example.json` |

Run **one** copy against a data folder. Several processes work (writes are locked), but one is simpler.

## Settings

Your invoice details (name, address, picture, how to pay you, notes, email text and currency) are set in the app:
**? → Your invoice details…**, or the form opens by itself the first time you make an invoice. They're saved to
`data/settings.json` (readable only by you).

For the rest, copy `settings.example.json` to `data/settings.json`: your default areas and operations, how long a
forgotten timer may run before it's stopped (default 8 h), and the host and port. Nothing personal is in the code.

## The screen

| Panel | What it does |
|---|---|
| Timer bar | Always visible. Start by typing, stop, switch, discard, open the details. |
| Navigator | Sets the scope for everything: Now, Unfiled, All projects, then clients and projects. Drag tasks onto it to file them; drag a project onto a client to move it. |
| Tasks | The open list for the scope, with a ▶ on every row. Right-click for more. |
| Timesheet | Entries for the scope and period (this/last week or month, all). Columns, CSV, add/edit, invoice. |
| Week | Day, 7-day or week timeline; click a block to edit it. |
| Presets | One-click timers that remember the labels you used last time, per project. |
| Inspector | Edits the running timer, a task (repeat rules included) or a project. |
| Projects | Cards with hours, what the time went on, and deadlines. |

The screen has four zones: a sidebar on each side, the main area, and the drawer along the bottom. Each zone is a
stack of tabs. Drag a tab onto another zone to stack it there; an empty zone opens when you drop a tab at that
edge of the window. Click the tab that's showing (or the arrow) to fold a sidebar into a slim strip or the drawer
into a bar. A sidebar can run the full height of the window, or sit above the drawer: use the button beside its
arrow. The main area never folds or empties.

Workspaces (top bar): **Plan**, **Track**, **Review**, **Timer** (just the clock, for a small window), or save your
own. Each one remembers its zones, sizes and folds in your browser. In a narrow window the sidebars fold for the
moment, without changing your saved layout. `⌘1…⌘6` jump to a panel.

The first time you open Clock-in' a one-minute tour shows you around. Replay it from **? → Take the tour**.

## Tests

```bash
python3 tests/smoke.py      # end-to-end API checks on throwaway demo data
```

## Credits and licence

The docking uses [dockview-core](https://github.com/mathuo/dockview) 8.6.1 (MIT), vendored in
`static/vendor/dockview-core/` with its licence (`LICENCE.md`). Only its open-source core is used.

Clock-in' itself is MIT licensed: see [`LICENSE`](LICENSE).
