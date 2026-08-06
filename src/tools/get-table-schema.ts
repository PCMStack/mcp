import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withCdb } from "../cdb";

const outputSchema = z.object({
	name: z.string().describe("Table name"),
	rowCount: z.number().describe("Number of rows in the table"),
	columns: z
		.array(
			z.object({
				name: z.string().describe("Column name"),
				type: z.string().describe("Column SQL type"),
				notNull: z
					.boolean()
					.describe("Whether the column has a NOT NULL constraint"),
				primaryKey: z
					.boolean()
					.describe("Whether the column is part of the primary key"),
			}),
		)
		.describe("Columns (schema) of the table"),
	columnCount: z.number().describe("Number of columns in the table"),
});

export function registerGetTableSchema(server: McpServer): void {
	server.registerTool(
		"pcm_get_table_schema",
		{
			title: "Get PCM table schema",
			description:
				"Inspect a single table inside a Pro Cycling Manager `.cdb` database by name. Returns the table's columns (name, SQL type, NOT NULL and primary key flags) and its row count. Use `pcm_list_tables` first to discover available table names.",
			inputSchema: {
				databasePath: z
					.string()
					.describe("Absolute path to the .cdb database file"),
				tableName: z
					.string()
					.describe(
						"Name of the table to inspect, as listed by `pcm_list_tables`",
					),
			},
			outputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ databasePath, tableName }) =>
			withCdb(databasePath, (db, file) => {
				// Validate the table exists (and guard against SQL injection) by
				// matching the name against DB_STRUCTURE before interpolating it.
				// DB_STRUCTURE columns aren't named, so read by position: the table
				// name is the first column (see list_tables).
				const structure = db.exec("SELECT * FROM DB_STRUCTURE");
				const knownTables = (structure[0]?.values ?? []).map((row) =>
					String(row[0]),
				);
				if (!knownTables.includes(tableName)) {
					throw new Error(
						`Table "${tableName}" not found in ${file.name}. Use pcm_list_tables to list available tables.`,
					);
				}

				const safeTableName = tableName.replaceAll('"', '""');

				const columnInfo = db.exec(`PRAGMA table_info("${safeTableName}")`);
				const columnRows = columnInfo[0]?.values ?? [];

				// PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
				const columns = columnRows.map((row) => ({
					name: String(row[1]),
					type: String(row[2]),
					notNull: Number(row[3]) === 1,
					primaryKey: Number(row[5]) > 0,
				}));

				const countResult = db.exec(`SELECT COUNT(*) FROM "${safeTableName}"`);
				const rowCount = Number(countResult[0]?.values?.[0]?.[0] ?? 0);

				const output: z.infer<typeof outputSchema> = {
					name: tableName,
					rowCount,
					columns,
					columnCount: columns.length,
				};

				return output;
			}),
	);
}
