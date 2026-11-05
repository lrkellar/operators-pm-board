# Guided planner

The board's **+ New Project → Plan it with the council** opens a guided planning page. The
council doesn't run in the browser. It runs on your PC through this small planner, which drives
**Claude Code in headless mode (`claude -p`) signed in with your Claude account**. All the
planning work therefore comes out of your Claude plan's usage. No API key is involved and
nothing is billed per token.

```
Board in the browser  ──localhost:43128──▶  planner (this folder)  ──▶  claude -p  (your Claude subscription)
   │ Google sign-in                              │ writes the project folder in project-council-library\projects\
   ▼                                             │ serves gate files to the board
Google Drive (council-plans.json, projects.csv)  ◀── the board saves gates and reviews there itself
```

**Your Google sign-in and your Claude sign-in never meet.**
- Google sign-in stays in the browser and only reaches Drive.
- The planner never sees a Google token.
- Claude Code uses its own login on this PC.

## One-time setup

1. **Install Node.js 20 or later** and Claude Code.
2. **Sign Claude Code in to your Claude account:** open a terminal, run `claude`, and choose
   your Claude (Pro or Max) account. Don't choose a Console or API key.
3. **Check where the library and plugin are.** By default the planner looks next to this
   repo:
   - `..\project-council-library`
   - `..\project-council`

   If yours are elsewhere, copy `planner.config.example.json` to `planner.config.json` and edit
   the paths.
4. **Check that everything is ready:** `npm run planner:check`. It should end with "Ready: the
   planner will run on your Claude subscription."

## Each time you plan

1. Double-click **`Start planner.cmd`** in the repo folder (or run `npm run planner`), and leave
   the window open.
2. In the board, click **+ New Project**, type a name and choose **Plan it with the council**.
   - The status chip at the top right should read *Claude subscription*.
   - If Chrome asks whether the board may access devices on your local network, allow it. That
     is how the page reaches the planner on `127.0.0.1`.
3. Describe the idea, then answer one question at a time. These steps come in order:
   1. the scoping interview;
   2. approving the expert panel;
   3. the decision interviews, with the options side by side and each expert's take;
   4. a review gate after each level.
4. **At a gate,** click **Put it on the board and review**. The board saves that level to
   Drive and opens the gate page. When you press **Approve level** or **Send back**, the review
   goes straight to the planner and the council carries on.

You can close the tab while the council works; the work continues on your PC. Reopen it from
**+ New Project → Plan it with the council → Pick up where you left off**.

## How it protects you from per-token charges

- **It checks how Claude Code is signed in before every turn.** It runs
  `claude auth status`, which costs nothing. It only proceeds when the sign-in method is your
  Claude account (`claude.ai`, or `oauth_token` from `claude setup-token`). An API key, an API
  key helper, or a cloud provider sign-in stops it with an explanation.
- **It strips billing settings from Claude Code's environment.** It removes
  `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and the Bedrock, Vertex
  and Foundry switches, so a stray key in your environment can't take over.
- **It never uses `--bare` mode.** That mode ignores your subscription login.
- **It runs one plan at a time,** which keeps the load inside your plan's limits.
- **When your plan's usage limit is reached, the session pauses.** The page shows when the limit
  resets and offers **Continue**. Nothing is lost: every step writes its files as it goes.

## What it runs

Each of your answers starts one headless turn in the project folder:

```
claude -p --output-format stream-json --verbose --resume <session>
  --permission-mode acceptEdits --settings <allow list> --append-system-prompt-file <guided rules>
  --strict-mcp-config --mcp-config <no servers> --add-dir <library> --add-dir <plugin> --plugin-dir <plugin>
```

- **The plugin's `guided-session` skill** tells the conductor to end every turn with a
  `council-ui` block: one question, one decision card or one gate. The page draws that block.
- **The allow list** lets Claude:
  - read and write files;
  - run subagents, skills and web research;
  - run `python …` (the council's scripts).

  Other shell commands are refused, because there is nobody at a terminal to approve them.
- **No MCP servers start,** so the board's own connector is never launched twice.

## Endpoints (localhost only)

The planner listens on `127.0.0.1` only. It answers only the board's origins: `localhost:5173`
and `lrkellar.github.io`.

| Method | Path | What it does |
|---|---|---|
| GET | `/status` | Claude Code version, sign-in method, library and plugin paths |
| GET, POST | `/projects` | List guided sessions; start one with `{name, idea}` |
| GET | `/projects/<slug>?since=n` | Transcript, live activity, gate files |
| POST | `/projects/<slug>/reply` | Your answer: `{choice, text}` |
| POST | `/projects/<slug>/review` | A gate review saved on the board; starts the next turn |
| POST | `/projects/<slug>/retry`, `/stop` | Continue after a limit or error, or stop a turn |
| GET | `/projects/<slug>/gate?file=plan/gates/L0-r1.json` | A gate file, for the board to import |

Each project's files are in `project-council-library\projects\<slug>\`:
- `.guided\session.json` and `transcript.jsonl` hold the session;
- `plan\guided-state.md` is the conductor's own notes between turns.

## Settings (`planner.config.json`)

| Key | Default | Meaning |
|---|---|---|
| `library` | `..\project-council-library` | The council library |
| `plugin` | `..\project-council` | The project-council plugin folder |
| `load_plugin_dir` | `true` | Load the plugin with `--plugin-dir`. Set to `false` if you installed it from a marketplace. |
| `model` | `null` | Your Claude Code default. Agents keep the model named in their own files. |
| `claude` | `null` | The full path to `claude.exe` or `claude.cmd`, if it isn't on PATH |
| `python` | `null` | An extra Python launcher to allow, such as `py` |
| `allowed_origins` | `[]` | Extra board origins, such as a preview port |
| `port` | `43128` | The port the planner listens on |
