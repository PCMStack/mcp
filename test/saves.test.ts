import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCloudDirectories, listSaves } from "../src/saves";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "pcm-test-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** Create `<root>/Pro Cycling Manager <year>/Cloud/<profile>/<name>`. */
async function writeSave(year: string, profile: string, name: string) {
	const dir = join(root, `Pro Cycling Manager ${year}`, "Cloud", profile);
	await mkdir(dir, { recursive: true });
	const path = join(dir, name);
	await writeFile(path, "save data");
	return path;
}

describe("findCloudDirectories", () => {
	it("finds the Cloud folder of each installed PCM version", async () => {
		await writeSave("2024", "steam-id", "Career.cdb");
		await writeSave("2025", "steam-id", "Career.cdb");

		const dirs = await findCloudDirectories(root);

		expect(dirs).toContain(join(root, "Pro Cycling Manager 2024", "Cloud"));
		expect(dirs).toContain(join(root, "Pro Cycling Manager 2025", "Cloud"));
		expect(dirs).toHaveLength(2);
	});

	it("returns an empty list when the root does not exist", async () => {
		const dirs = await findCloudDirectories(join(root, "missing"));

		expect(dirs).toEqual([]);
	});
});

describe("listSaves", () => {
	it("collects every .cdb save across versions", async () => {
		await writeSave("2024", "steam-id", "MyCareer.cdb");
		await writeSave("2025", "steam-id", "Other.cdb");

		const saves = await listSaves(root);

		expect(saves.map((s) => s.name).sort()).toEqual([
			"MyCareer.cdb",
			"Other.cdb",
		]);
		expect(saves[0].sizeBytes).toBeGreaterThan(0);
	});

	it("returns the newest save first", async () => {
		const older = await writeSave("2024", "steam-id", "Old.cdb");
		const newer = await writeSave("2025", "steam-id", "New.cdb");

		await utimes(older, new Date("2024-01-01"), new Date("2024-01-01"));
		await utimes(newer, new Date("2025-01-01"), new Date("2025-01-01"));

		const saves = await listSaves(root);

		expect(saves[0].name).toBe("New.cdb");
	});
});
