import { promises as fs } from "fs";
import * as path from "path";

export async function ensureDirectoryExists(filePath: string): Promise<void> {
	const dirPath = path.dirname(filePath); // Extracts directory from file path
	try {
		await fs.mkdir(dirPath, { recursive: true }); // ✅ Creates directory recursively if it doesn’t exist
	} catch (error) {
		console.error("Error creating directory:", error);
	}
}

export async function createDir(dirPath: string): Promise<void> {
	try {
		await fs.mkdir(dirPath, { recursive: true });
	} catch (error) {
		console.error("Error creating directory:", error);
	}
}