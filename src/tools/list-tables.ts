import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withCdb } from "../cdb";

const outputSchema = z.object({
	tables: z
		.array(
			z.object({
				id: z.number().describe("Table ID"),
				name: z.string().describe("Table name"),
			}),
		)
		.describe("Tables in the .cdb database"),
	tableCount: z.number().describe("Number of tables in the .cdb database"),
});

export function registerListTables(server: McpServer): void {
	server.registerTool(
		"pcm_list_tables",
		{
			title: "List PCM database tables",
			description:
				"List every table in a Pro Cycling Manager `.cdb` database via DB_STRUCTURE (table id + name), plus the total table count. Use `pcm_get_table_schema` next to inspect a table's columns.",
			inputSchema: {
				databasePath: z
					.string()
					.describe("Absolute path to the .cdb database file"),
			},
			outputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ databasePath }) =>
			withCdb(databasePath, (db) => {
				const results = db.exec("SELECT * FROM DB_STRUCTURE");
				const rows = results[0]?.values ?? [];

				const tables = rows.map((row) => ({
					id: Number(row[1]),
					name: String(row[0]),
				}));

				const output: z.infer<typeof outputSchema> = {
					tables,
					tableCount: tables.length,
				};

				return output;
			}),
	);
}
