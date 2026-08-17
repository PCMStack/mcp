<p align="center">
  <img src="assets/icon.png" alt="PCM MCP" width="150" />
</p>

<h1 align="center">Pro Cycling Manager MCP Server</h1>

<p align="center">
  Explore your <strong>Pro Cycling Manager</strong> databases with an AI assistant: cyclists, teams, rosters and startlists, straight from the game's own files.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pcm-mcp"><img src="https://img.shields.io/npm/v/pcm-mcp.svg" alt="npm version" /></a>
  <a href="https://github.com/PCMStack/mcp/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/pcm-mcp.svg" alt="license" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/pcm-mcp.svg" alt="node version" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-blue.svg" alt="MCP compatible" /></a>
</p>

`pcm-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI assistants such as Claude Desktop, ChatGPT and Gemini query your [Pro Cycling Manager](https://www.cyanide-studio.com/) (PCM) databases. Ask about a cyclist's ratings, browse a team's roster, run SQL against the database, or generate a race startlist, all in plain language.

> [!IMPORTANT]
> This server never modifies your existing files. PCM stores its data as binary `.cdb` files; each call re-reads the `.cdb` from disk and loads it into an **in-memory** SQLite database. Every read tool leaves the source untouched. The write tools, `pcm_update_database` and `pcm_update_cyclist_ratings`, serialize their changes to a **new** `.cdb` file (`outputPath`) and refuse to overwrite the input, so keep your original as a backup.

### Saves and databases

A `.cdb` file is a database, in Cyanide's own binary format. Your **saves** are `.cdb` databases the game writes as you play, but so are the official releases shipped with the game and the community updates you can download, and the tools here work on any of them.

That is why one tool speaks of saves and the rest speak of databases:

- **`pcm_list_saves`** finds _your_ saves, across every PCM edition installed on the machine.
- **Every other tool** takes a `databasePath`, the path to any `.cdb`, whether it came from `pcm_list_saves` or from somewhere else entirely.

## Features

- **Zero setup**: run it with a single `npx` command, or install a `.mcpb` bundle with no terminal at all.
- **Save discovery**: auto-detect your saves on Windows, or point at any `.cdb` file directly.
- **Rich queries**: search cyclists and teams, inspect rosters with full per-terrain ratings, and read player info.
- **Raw SQL**: run guarded, read-only `SELECT` queries against any table.
- **Guarded edits**: apply a single `INSERT`/`UPDATE`/`DELETE`, or edit a cyclist's ratings directly, and write the result to a new `.cdb`, never touching the original.
- **Startlist export**: generate a PCM-ready startlist XML from a set of teams and rosters.
- **Safe by design**: read tools are auto-approved by MCP clients; the write tools write only to a separate output file and never overwrite an existing one.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 22 or later (not required for the `.mcpb` bundle install)
- A Pro Cycling Manager database (a `.cdb` file: a save, an official release or a community update)

### Install

<details open>
<summary><strong>MCP Bundle (Claude Desktop, no terminal)</strong></summary>

Download the latest `pcm-mcp.mcpb` from the [Releases page](https://github.com/PCMStack/mcp/releases) and open it with **Claude for macOS or Windows**. An installation dialog appears, no terminal required.

> [!NOTE]
> This method does not auto-update. To get a newer version, download and re-install the latest `.mcpb` from the Releases page.

</details>

<details>
<summary><strong>Claude Desktop, ChatGPT Desktop or Gemini CLI (via <code>npx</code>)</strong></summary>

Add the following to your client's MCP configuration file (`claude_desktop_config.json`, the ChatGPT MCP config, or the Gemini CLI settings file):

```json
{
  "mcpServers": {
    "pcm-mcp": {
      "command": "npx",
      "args": ["-y", "pcm-mcp"]
    }
  }
}
```

</details>

Once configured, restart your client and ask it something like _"list my PCM saves"_ or _"show me the roster of my team"_.

## Platform support

PCM only ships on Windows, where saves live under:

```
%APPDATA%/Pro Cycling Manager <year>/Cloud/<profile>/
```

Auto-discovery via `pcm_list_saves` is therefore **Windows only**. On macOS/Linux the saves live inside a Wine/Proton prefix that can't be reliably located, so pass an absolute `.cdb` path directly to `pcm_validate_database` instead.

## Available tools

All tools are prefixed with `pcm_`, and every one except `pcm_list_saves` takes an absolute `databasePath`. Every tool except `pcm_update_database` and `pcm_update_cyclist_ratings` is read-only, so clients like Claude Desktop can approve them automatically without a confirmation prompt. The two write tools never overwrite the source or any existing file; they can only create a new `.cdb`.

| Tool                           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **pcm_list_saves**             | Discover your PCM saves on this machine by scanning the `Pro Cycling Manager <year>/Cloud` folders under `%APPDATA%`, across every installed edition (Windows only). Returns each save's absolute path (pass it as `databasePath` to the other tools), plus file name, last modified date and size (newest first).                                                                                                                                                                                                                                                                   |
| **pcm_validate_database**      | Validate that an absolute path points to an existing `.cdb` database and return its metadata. Stateless: keep the returned path in conversation context to pass to later tools.                                                                                                                                                                                                                                                                                                                                                                                                      |
| **pcm_list_tables**            | List every table inside a `.cdb` database, with its ID and name, plus the total table count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **pcm_get_table_schema**       | Inspect a single table by name. Returns its columns (name, SQL type, NOT NULL and primary key flags) and its row count. Use `pcm_list_tables` first to discover available table names.                                                                                                                                                                                                                                                                                                                                                                                               |
| **pcm_get_player_info**        | Get the active human player and their team. Returns the player login plus team details (name, resolved division name, resolved country name, evaluation and manager).                                                                                                                                                                                                                                                                                                                                                                                                                |
| **pcm_search_cyclist**         | Search for a cyclist by first name and/or last name (case-insensitive partial match). Returns up to 10 matches with all ratings (plain, mountain, medium mountain, downhilling, cobble, time trial, prologue, sprint, acceleration, endurance, resistance, recuperation, hill, baroudeur, current ability) and the resolved country name; a `truncated` flag signals when more matches exist. `mediumMountain` and `currentAbility` are `null` on databases that pre-date those columns.                                                                                             |
| **pcm_get_team_roster**        | List a team's roster (defaults to the active player's team when `teamId` is omitted). Joins DYN_cyclist with its active DYN_contract_cyclist and STA_type_rider; per rider returns name, country, age (derived from birth date and the current game date), rider type, overall ability, contract end year, wage, market value and all per-terrain ability ratings. Ordered by overall ability, highest first. Errors if `teamId` does not exist.                                                                                                                                     |
| **pcm_search_team**            | Search for a team by name (case-insensitive partial match against both the full name and short name). Returns up to 10 matches with the resolved division name, country name, evaluation and general manager; a `truncated` flag signals when more matches exist.                                                                                                                                                                                                                                                                                                                    |
| **pcm_query_database**         | Run a read-only SQL query (`SELECT` / `WITH … SELECT` only) against any table. Write/DDL statements are rejected. Results are capped (default 100, max 1000 rows).                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **pcm_update_database**        | Apply a single `INSERT`/`UPDATE`/`DELETE` statement and write the modified database to a **new** `.cdb` at `outputPath`. The source is never overwritten (`outputPath` must differ from `databasePath`); `SELECT`, schema changes (`DROP`/`CREATE`/`ALTER`) and stacked statements are rejected. Returns the written path and the number of rows changed.                                                                                                                                                                                                                            |
| **pcm_update_cyclist_ratings** | Change one or more ability ratings of a cyclist (by `IDcyclist`) and write the modified database to a **new** `.cdb` at `outputPath`. Takes a `ratings` object where each field is optional (`plain`, `mountain`, `mediumMountain`, `downhilling`, `cobble`, `timeTrial`, `prologue`, `sprint`, `acceleration`, `endurance`, `resistance`, `recuperation`, `hill`, `baroudeur`; 50–85); only the fields provided are changed. Returns the written path and the cyclist's full ratings after the update. Setting `mediumMountain` is rejected on databases that pre-date that column. |
| **pcm_generate_startlist_xml** | Generate a PCM startlist XML document from a list of teams and their cyclist rosters. Looks up the race by `IDrace` to derive the output file name from `STA_race.gene_sz_filename` (e.g. `c0_almeria.xml`), and returns both the file name and the XML as text. Team and cyclist IDs map to `DYN_team.IDteam` / `DYN_cyclist.IDcyclist` (look them up with `pcm_search_cyclist` or `pcm_query_database`).                                                                                                                                                                           |

## How it works

Tools are **stateless**: there is no "current database" held by the server. Every tool takes an absolute `databasePath`, re-validates it, and re-reads the `.cdb` from disk into a fresh in-memory SQLite database (via [`cdb-converter`](https://www.npmjs.com/package/cdb-converter) + [`sql.js`](https://www.npmjs.com/package/sql.js)) for each call. The file on disk is never mutated: read tools only ever read it, and the write tools (`pcm_update_database`, `pcm_update_cyclist_ratings`) write their changes to a separate output `.cdb`. A typical flow is:

1. `pcm_list_saves` (Windows) to find your saves, or `pcm_validate_database` with an explicit path to point at any `.cdb`.
2. `pcm_search_cyclist`, `pcm_get_team_roster`, `pcm_query_database`, … to explore it.
3. `pcm_generate_startlist_xml` to produce a startlist file for a race, or `pcm_update_cyclist_ratings` / `pcm_update_database` to write an edited copy.

## Renamed tools

Several tools and the parameter they all take were renamed, so that "save" now means only what the game itself saved and everything else says "database". MCP clients read the tool list at connect time, so **no configuration change is needed**: restart your client and it picks up the new names. Only hand-written prompts, scripts or skills that name a tool or `savePath` explicitly need updating:

| Before                 | After                   |
| ---------------------- | ----------------------- |
| `savePath` (all tools) | `databasePath`          |
| `pcm_validate_save`    | `pcm_validate_database` |
| `pcm_get_save_schema`  | `pcm_list_tables`       |
| `pcm_query_save`       | `pcm_query_database`    |
| `pcm_update_save`      | `pcm_update_database`   |

`pcm_list_saves` keeps its name: it is the one tool genuinely about your saves. All other tools are unchanged.

## Development

Clone the repo and install dependencies with `npm install`, then:

```bash
npm run build     # bundle src/ -> dist/ with tsup (ESM output)
npm test          # run the vitest suite once
npm run test:watch  # vitest in watch mode
npm run coverage  # vitest with v8 coverage
npm run lint      # biome lint --write . (autofixes)
npm run format    # biome format --write .
npm run pack      # produce dist/pcm-mcp.mcpb
```

To debug the server interactively with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npm run build && npm run inspector
```
