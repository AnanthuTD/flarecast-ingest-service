import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "./logger";

export async function createHLS(
	inputPath,
	outputDir,
	resolutions = [480, 720]
) {
	try {
		fs.mkdirSync(outputDir, { recursive: true });

		for (const resolution of resolutions) {
			const outputPath = path.join(outputDir, `${resolution}p.m3u8`);
			const segmentFilename = path.join(outputDir, `${resolution}p_%03d.ts`);
			const FFMPEG_LOCATION = process.env.FFMPEG_LOCATION; // Ensure this is set correctly

			const command = `ffmpeg -i "${inputPath}" -vf scale="trunc(oh*a/2)*2:${resolution}" -c:v libx264 -b:v ${getBitrate(
				resolution
			)}k -c:a aac -ar 44100 -f hls -hls_time 10 -hls_list_size 0 -hls_segment_filename "${segmentFilename}" "${outputPath}"`;

			logger.info(`Executing command for ${resolution}p: ${command}`);

			await new Promise((resolve, reject) => { 
				exec(command, (error, stdout, stderr) => {
					if (error) {
						logger.error(`Error for ${resolution}p:`, error);
						logger.error(`Stderr for ${resolution}p:`, stderr);
						reject(error);
					} else {
						logger.info(`Finished processing ${resolution}p.`);
						resolve();
					}
				});
			});
		}

		logger.info("All resolutions processed successfully!");
		return outputDir;
	} catch (err) {
		logger.error("Error creating HLS:", err);
		throw err;
	}
}

export const getBitrate = (resolution: number) => {
	switch (resolution) {
		case 480:
			return 800;
		case 720:
			return 2000;
		case 1080:
			return 4000;
		default:
			return 800;
	}
};

const getResolution = (height: number) => {
	switch (height) {
		case 480:
			return "854x480";
		case 720:
			return "1280x720";
		case 1080:
			return "1920x1080";
		default:
			return "854x480";
	}
};

const getCodec = (resolution: number) => {
	switch (resolution) {
		case 480:
			return "avc1.64001E,mp4a.40.2";
		case 720:
			return "avc1.64001F,mp4a.40.2";
		case 1080:
			return "avc1.640028,mp4a.40.2";
		default:
			return "avc1.64001E,mp4a.40.2";
	}
};

export function createMasterPlaylist(basePath: string, resolutions: number[]) {
	let playlist = "#EXTM3U\n#EXT-X-VERSION:6\n";
	resolutions.forEach((res) => {
		const bandwidth = getBitrate(res) * 1000;
		const resolution = getResolution(res);
		playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},CODECS="${getCodec(
			res
		)}"\n`;
		playlist += `${basePath}/${res}/index.m3u8\n`;
	});
	return playlist;
}
