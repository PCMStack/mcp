import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResponse, validResponse } from "../helpers";
import { validateCdb } from "../cdb";

const outputSchema = z.object({
	path: z.string().describe("Absolute path to the .cdb database file"),
	name: z.string().describe("File name, e.g. `OfficialRelease-2025.cdb`"),
	lastModified: z
		.string()
		.describe(
			"Last modified timestamp in ISO 8601 format, e.g. `2024-06-01T12:34:56.789Z`",
		),
	sizeBytes: z.number().describe("File size in bytes"),
});

export function registerValidateDatabase(server: McpServer): void {
	server.registerTool(
		"pcm_validate_database",
		{
			title: "Validate PCM database",
			description:
				"Validate that an absolute path points to an existing Pro Cycling Manager `.cdb` database and return its metadata. Stateless: nothing is stored — keep the returned path in conversation context to pass to later tools.",
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
		async ({ databasePath }) => {
			try {
				const file = await validateCdb(databasePath);

				const output: z.infer<typeof outputSchema> = {
					...file,
				};

				return validResponse(output);
			} catch (error) {
				return errorResponse(
					error instanceof Error ? error.message : String(error),
				);
			}
		},
	);
}
