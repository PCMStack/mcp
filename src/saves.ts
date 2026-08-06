import { readdir, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { CdbFile } from "./cdb";

/**
 * Discovery of the player's own career saves, per installed PCM edition.
 *
 * This is the only module where "save" is meant literally: a `.cdb` written by
 * the game as the player plays a career. Everywhere else a `.cdb` is just a
 * database (see `cdb.ts`), which may equally be an official release or a
 * community update the player never saved themselves.
 */

/** PCM version folders are named like `Pro Cycling Manager 2024`. */
const PCM_FOLDER_PREFIX = "Pro Cycling Manager";

/**
 * Within each version folder, ongoing saves live under `Cloud/<profile>/`,
 * where `<profile>` is the player's SteamID64 or a
 * profile name, depending on the PCM version.
 * (Timestamped backups live in a sibling `WeeklySaves/` folder, which we
 * intentionally do not scan — only live saves are surfaced.)
 */
const CLOUD_DIR = "Cloud";

/**
 * Absolute path to the roaming AppData directory that holds the per-version
 * `Pro Cycling Manager <year>` folders.
 *
 * PCM only ships on Windows, where saves live under
 * `%APPDATA%/Pro Cycling Manager <year>/Cloud/<profile>/` (where `<profile>` is
 * a SteamID64 or a profile name). On macOS/Linux the
 * saves live inside a Wine/Proton prefix that we can't reliably locate, so
 * auto-discovery is unsupported there — pass an absolute `.cdb` path to
 * `pcm_validate_database` instead.
 *
 * @throws on non-Windows platforms.
 */
export function getPcmRoot(): string {
	if (platform() !== "win32") {
		throw new Error(
			"Pro Cycling Manager save auto-discovery is only supported on Windows. " +
				"On macOS/Linux the saves live inside a Wine/Proton prefix — " +
				"pass an absolute .cdb path to pcm_validate_database instead.",
		);
	}
	return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Find every `<root>/Pro Cycling Manager <year>/Cloud` directory that exists,
 * across all installed PCM versions.
 *
 * @param root - The roaming AppData directory to scan. Defaults to the
 *   OS-specific location.
 */
export async function findCloudDirectories(
	root: string = getPcmRoot(),
): Promise<string[]> {
	if (!(await isDirectory(root))) {
		return [];
	}

	const entries = await readdir(root, { withFileTypes: true });
	const dirs: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (!entry.name.startsWith(PCM_FOLDER_PREFIX)) continue;

		const cloudDir = join(root, entry.name, CLOUD_DIR);
		if (await isDirectory(cloudDir)) {
			dirs.push(cloudDir);
		}
	}
	return dirs;
}

/**
 * Recursively collect `.cdb` files under `dir` (saves nest one level deep
 * inside a `<profile>` folder, but we walk arbitrary depth to be safe).
 */
async function collectCdbFiles(dir: string): Promise<CdbFile[]> {
	const saves: CdbFile[] = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			saves.push(...(await collectCdbFiles(fullPath)));
			continue;
		}
		if (!entry.isFile()) continue;
		if (!entry.name.toLowerCase().endsWith(".cdb")) continue;

		const info = await stat(fullPath);
		saves.push({
			path: fullPath,
			name: entry.name,
			lastModified: info.mtime.toISOString(),
			sizeBytes: info.size,
		});
	}
	return saves;
}

/**
 * Discover all PCM career saves on the local machine, newest first.
 *
 * @param root - The roaming AppData directory to scan. Defaults to the
 *   OS-specific location.
 * @throws if no roaming AppData directory exists (PCM not installed, or saves
 *   live in a custom location).
 */
export async function listSaves(
	root: string = getPcmRoot(),
): Promise<CdbFile[]> {
	if (!(await isDirectory(root))) {
		throw new Error(
			`No Pro Cycling Manager data found. Expected a "Pro Cycling Manager <year>" folder under: ${root}. ` +
				"PCM may not be installed, or its saves live in a custom location — " +
				"pass an absolute .cdb path to pcm_validate_database instead.",
		);
	}

	const cloudDirs = await findCloudDirectories(root);
	const saves: CdbFile[] = [];
	for (const dir of cloudDirs) {
		saves.push(...(await collectCdbFiles(dir)));
	}

	saves.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
	return saves;
}
