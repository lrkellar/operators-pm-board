# Local MCP connector

The connector runs on the user's computer and exposes the board to Claude Desktop over MCP stdio. It reads and writes the same `projects.csv` and `settings.json` in Google Drive as the web app. It does not call an AI model API.

## Quick start (no Claude Desktop setup)

Double-click **Start connector.cmd** in the board folder, or run:

```
cd /d "C:\Users\Admin\Desktop\Programming\operators-pm-board"
node mcp\server.js
```

Leave the window open, then click **Connect this session** in the board's AI Connector panel.
When the connector isn't running, the panel shows these same commands with a Copy button.
A copy started this way only proves the board can reach it. For Claude Desktop to use the
board tools in a chat, Claude has to start the connector itself, which needs the setup below.
Close this window before restarting Claude, because only one copy can hold port 43127.

## Claude Desktop setup on Windows

1. Install this project and its dependencies with `npm ci`.
2. Open Claude Desktop's MCP configuration file at `%APPDATA%\Claude\claude_desktop_config.json`.
3. Add this server entry, replacing the project path with this checkout's absolute path. If `node` isn't on Claude's PATH, use the full path to `node.exe` as the `command` value.

```json
{
  "mcpServers": {
    "operators-pm-board": {
      "command": "node",
      "args": ["C:\\Users\\Admin\\Desktop\\Programming\\operators-pm-board\\mcp\\server.js"]
    }
  }
}
```

4. Restart Claude Desktop. It starts the local MCP process.
5. Sign in to The Operators PM Board, open **AI Connector**, and click **Connect this session**.
6. In Claude, enable the Operators PM Board tools for a conversation.

## Tools

- `list_projects` and `get_project_tasks` read board data.
- `create_project`, `add_tasks_to_project`, and `update_task` edit plans. Writes go through the board's Google Drive save path and enter Drive revision history.
- `list_board_versions` and `restore_board_version` provide the seven-day rollback history.

The connector validates task IDs, dates, statuses, links, and dependency cycles before writing. It has no task-delete tool.

### Plan reviews (Project Council)

Project Council builds plans level by level (L0 outline, L1 strategy, L2 execution plan, L3 activities, L4 steps) and you review each level on the board's **Plan reviews** page. Levels under review live in `council-plans.json` in the same Drive folder, separate from `projects.csv`, so a draft plan never shows up among your live projects.

- `council_list_plans` lists plans and each level's status (ready for review, sent back, approved).
- `council_publish_level` publishes a gate file written by the council's `gate_publish.py`: pass its path (`plan/gates/L<n>-r<k>.json`). The connector reads the file itself, so large levels never pass through the conversation.
- `council_get_review` returns your review of a level: the decision, your overall comment, a mark (approve, change, question) and comment per item, and change-request decisions. With `save_to` it also writes the review to a `-review.json` file for the council's `gate_apply.py`.
- `council_promote_level` puts an approved level (L2 to L4) onto the board as a live project for one scenario, keeping task status and progress if you promote again later.

To use these tools from Claude Code (where the council runs), add the same server there once:

```
claude mcp add operators-pm-board -- node C:\Users\Admin\Desktop\Programming\operators-pm-board\mcp\server.js
```

Then click **Connect this session** in the board's AI Connector panel, as for Claude Desktop. Without the connector, the board's **Import level** button reads a gate file directly.

## Session and privacy

The board sends its short-lived Google OAuth access token to `127.0.0.1:43127` only after the user clicks Connect. The local process validates it with Google's user-info endpoint and keeps it in memory; it is never written to disk. It expires with the Google session. Disconnect in the AI Connector panel or stop Claude Desktop to clear it. The MCP server accepts browser connections only from the configured board origins (`http://localhost:5173`, `http://127.0.0.1:5173`, and `https://lrkellar.github.io` by default). Set `OPM_MCP_ALLOWED_ORIGINS` to a comma-separated list to add other exact origins.

This first connector is local stdio for Claude Desktop. Connecting ChatGPT requires an HTTP transport/tunnel and is a separate follow-up.
