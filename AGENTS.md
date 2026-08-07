# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Model Context Protocol (MCP) server that exposes Pro Cycling Manager (PCM)
databases to an LLM client over stdio. Each call re-reads the `.cdb` from disk and
loads it into an in-memory sql.js (SQLite) database (via `cdb-converter`), so the
on-disk file is the single source of truth and **is never modified**. Write tools
(`pcm_update_database`, `pcm_update_cyclist_ratings`) mutate the in-memory copy and
serialize it to a **new** `.cdb` via `writeCdb`, which refuses to overwrite the
source or any existing file. Any new tool must keep this never-touch-the-source
guarantee.

### Terminology

Two words, deliberately not interchangeable:

- **database** — a `.cdb` file. Cyanide's binary database format, and what every
  tool but one actually operates on. It may be a player save, an official release
  or a community update; nothing downstream cares which. The input parameter is
  `databasePath`, and the internals live in `src/cdb.ts`.
- **save** — a `.cdb` the *game itself wrote* as the player played,
  discovered under a PCM edition's `Cloud/` folder. This meaning is confined to
  `src/saves.ts` and `pcm_list_saves`.

So `pcm_list_saves` finds the player's saves; everything else takes any database.
Do not reintroduce "save" as a synonym for `.cdb` — the test fixtures are official
releases, not saves, which is precisely the case the old naming got wrong.

## Stack

- **Runtime/lang:** Node.js (ESM, `bundler` module resolution), TypeScript (strict).
- **MCP:** `@modelcontextprotocol/sdk` — `McpServer` + `StdioServerTransport`.
- **Database parsing:** `cdb-converter` (`cdbToSql`) + `sql.js` (in-memory SQLite).
- **Schemas:** `zod` for tool input/output schemas.
- **Build:** `tsup` → `dist/` (ESM output; `.d.ts` currently disabled). **Test:** `vitest`.
  **Lint/format:** `biome`.

## Layout

```
src/
  index.ts        # entrypoint: builds McpServer, registers tools, connects stdio
  cdb.ts          # everything touching a .cdb: validate a path, open it in memory, serialize an edited copy, schema/game-date introspection
  saves.ts        # locate the player's saves across installed PCM editions
  helpers.ts      # cross-cutting utilities: MCP tool responses, SQL statement parsing/errors, dates, startlist XML
  schemas/
    cyclist.ts          # shared cyclist ratings schema and its SQL read/write mappings
  tools/
    index.ts              # wires every tool onto the server
    list-saves.ts         # pcm_list_saves
    validate-database.ts  # pcm_validate_database
    list-tables.ts        # pcm_list_tables
    get-table-schema.ts   # pcm_get_table_schema
    get-player-info.ts    # pcm_get_player_info
    get-team-roster.ts    # pcm_get_team_roster
    search-cyclist.ts     # pcm_search_cyclist
    search-team.ts        # pcm_search_team
    query-database.ts     # pcm_query_database
    update-database.ts    # pcm_update_database
    update-cyclist-ratings.ts  # pcm_update_cyclist_ratings
    generate-startlist-xml.ts  # pcm_generate_startlist_xml
test/                 # vitest specs (test/**/*.test.ts)
```

## Tools

All tools are prefixed with `pcm_`. Every tool but `pcm_list_saves` takes an absolute `databasePath`. Read tools carry `readOnlyHint: true` / `destructiveHint: false` annotations so clients can auto-approve them. The two write tools (`pcm_update_database`, `pcm_update_cyclist_ratings`) carry `readOnlyHint: false`, but also `destructiveHint: false`: `writeCdb` refuses `outputPath === databasePath` and refuses to overwrite an existing file at `outputPath`, so the operation can only ever create a brand-new `.cdb` — it never destroys existing data.

| Tool                         | Purpose                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pcm_list_saves`             | Discover the player's saves by scanning `Pro Cycling Manager <year>/Cloud` under `%APPDATA%`, across every installed edition (**Windows only**). The only tool that is about saves specifically.                                               |
| `pcm_validate_database`      | Validate a `.cdb` path and return metadata. Stateless — the path must be kept in conversation context for later tools.                                                                                                                                |
| `pcm_list_tables`            | List all tables (id + name) via `DB_STRUCTURE`.                                                                                                                                                                                                       |
| `pcm_get_table_schema`       | Inspect one table: columns (name, type, NOT NULL, PK) + row count.                                                                                                                                                                                    |
| `pcm_get_player_info`        | Active human player + team (joins `GAM_user` `game_i_active = 1` with `DYN_team`).                                                                                                                                                                    |
| `pcm_get_team_roster`        | Team roster (defaults to active player's team). Joins `DYN_cyclist` with active `DYN_contract_cyclist` + `STA_type_rider`: name, country, age, type, overall, contract end, wage, value, plus per-terrain ratings (flat). Errors on unknown `teamId`. |
| `pcm_search_cyclist`         | Search cyclist by first/last name (partial, case-insensitive).                                                                                                                                                                                        |
| `pcm_search_team`            | Search team by name (partial, case-insensitive; matches full name and short name).                                                                                                                                                                    |
| `pcm_query_database`         | Run a single read-only `SELECT`/`WITH … SELECT`. Write/DDL rejected; results capped (default 100, max 1000).                                                                                                                                          |
| `pcm_update_database`        | Apply a single `INSERT`/`UPDATE`/`DELETE` and write the result to a **new** `.cdb` (`outputPath` must differ from `databasePath`). SELECT/DDL/stacked statements rejected.                                                                            |
| `pcm_update_cyclist_ratings` | Change one or more `charac_i_*` ratings of a cyclist (by `IDcyclist`, ratings 50–85) and write the result to a **new** `.cdb`. Returns the cyclist's full ratings after the update.                                                                   |
| `pcm_generate_startlist_xml` | Build a PCM startlist XML from teams + rosters; derives the file name from `STA_race.gene_sz_filename` for the given `IDrace`.                                                                                                                        |

## Conventions

- **State is in the conversation, not the server.** Tools are stateless; every
  database-reading tool takes an absolute `databasePath` and re-validates it via
  `validateCdb`. There is no "current database".
- **Use `withCdb` for new database-reading tools.** It centralises validate →
  read → convert → run → always-close.
- **Read-only is enforced defensively** even though the DB is in-memory — see
  `assertReadOnlyQuery` in `query-database.ts` (single statement, SELECT/WITH only,
  forbidden-keyword guard).
- **Guard against SQL injection** when interpolating identifiers: validate table
  names against `DB_STRUCTURE` before building queries (see `get_table_schema`).
- **Tool responses** go through `validResponse` / `errorResponse`; declare both
  `inputSchema` and `outputSchema` with zod.
- **Tool annotations** — every tool must include `readOnlyHint`, `destructiveHint`,
  `idempotentHint`, and `openWorldHint`. Read tools use `readOnlyHint: true` /
  `destructiveHint: false`; write tools the inverse.
- **Tool naming** — all tools are prefixed with `pcm_` (e.g. `pcm_list_saves`) to
  avoid conflicts when used alongside other MCP servers.
- **Platform:** auto-discovery is Windows-only. On macOS/Linux (Wine/Proton),
  `pcm_list_saves`/`getPcmRoot` throw — pass an absolute `.cdb` path to `pcm_validate_database`.
- **Logging** must go to `stderr` (`console.error`); stdout is the MCP transport.
- **Country fields** must use `STA_country.gene_sz_flag` (human-readable name, e.g.
  `France`), never `STA_country.CONSTANT` (internal constant). Keep this consistent
  across all tools that expose a cyclist/team country.

## README maintenance

After any change that affects the public interface of this server, update `README.md`
before considering the task done. This includes:

- Adding, removing, or renaming a tool
- Changing a tool's inputs, outputs, or description
- Changing platform support or installation requirements
- Changing the MCP transport or Claude Desktop configuration

The tool table in `README.md` must always match the exact tool names registered in the
source (currently prefixed with `pcm_`).

## Collaboration And Release Conventions

- Respect standard JavaScript library conventions for commits, pull requests, tags, and releases.
- Prefer Conventional Commit style when proposing commit messages or PR titles, especially for changes that affect release notes or semantic versioning.
- Keep pull requests focused, with a clear scope, user-visible impact, and explicit note when a change is breaking.
- Treat versioning and release artifacts as semver-driven. Breaking API or packaging changes must be clearly identified so they can drive a major release.
- Prefer annotated version tags that match the package release version format, such as `v0.1.0`, unless the repository documents another convention.
- When preparing release-related changes, make sure changelog, package metadata, exports, and release notes stay coherent with the actual API and runtime compatibility.

## Commands

```bash
npm run build        # bundle src/ -> dist/ with tsup (ESM output; `.d.ts` currently disabled)
npm test             # run the vitest suite once
npm run test:watch   # vitest in watch mode
npm run coverage     # vitest with v8 coverage (text + html + lcov)
npm run lint         # biome lint --write . (autofixes)
npm run format       # biome format --write .
```
