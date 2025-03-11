import NodeMediaServer from "node-media-server";
import chokidar from "chokidar";
import { uploadFileToS3 } from "./aws/uploadToS3";
import path from "path";
import { createDir } from "./helpers/fs.helper";
import { createMasterPlaylist } from "./transcode";
import { writeFileSync } from "fs";

const config = {
	rtmp: {
		port: 1935,
		chunk_size: 60000,
		gop_cache: true,
		ping: 30,
		ping_timeout: 60,
	},
	http: {
		port: 8000,
		mediaroot: "./media",
		allow_origin: "*",
	},
	trans: {
		ffmpeg:
			"C:\\Users\\anant\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-7.1-full_build\\bin\\ffmpeg.exe",
		tasks: [
			{
				app: "game",
				// vc: "copy",
				// ac: "copy",
				hls: true,
				hlsFlags: "[hls_time=2:hls_list_size=0:hls_flags=delete_segments]",
				hlsKeep: true,
			},
		],
	},
	fission: {
		ffmpeg:
			"C:\\Users\\anant\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-7.1-full_build\\bin\\ffmpeg.exe",
		tasks: [
			{
				rule: "game/*",
				model: [
					{
						ab: "128k",
						vb: "1500k",
						vs: "1280x720",
						vf: "30",
					},
					{
						ab: "96k",
						vb: "1000k",
						vs: "854x480",
						vf: "24",
					},
					{
						ab: "96k",
						vb: "600k",
						vs: "640x360",
						vf: "20",
					},
				],
			},
		],
	},
};

var nms = new NodeMediaServer(config);

const debouncedUpload = (fn, delay) => {
	let timeout;
	let retryCount = 0;
	return async (...args) => {
		clearTimeout(timeout);
		timeout = setTimeout(async () => {
			try {
				await fn(...args);
				retryCount = 0;
			} catch (error) {
				if (retryCount < 3) {
					retryCount++;
					setTimeout(() => fn(...args), 2000 * retryCount);
				}
			}
		}, delay);
	};
};

nms.on("postPublish", async (id, streamPath, args) => {
	try {
		const streamKey = streamPath.split("/").pop();
		if (!streamKey) throw new Error(`Invalid stream path: ${streamPath}`);

		const hlsBaseDir = path.join(process.cwd(), `media/game/${streamKey}`);
		await createDir(hlsBaseDir);

		// Create and upload master playlist
		const masterContent = createMasterPlaylist(streamKey, [1080, 720, 480]);
		const masterPath = path.join(hlsBaseDir, "master.m3u8");
		writeFileSync(masterPath, masterContent);
		await uploadFileToS3(
			masterPath,
			`game/${streamKey.split("_")[0]}/master.m3u8`
		);

		// Watch and upload HLS files
		const resolutions = [1080, 720, 480];
		const watchers = [];

		const resDir = path.join(hlsBaseDir);
		const s3Prefix =
			streamKey.split("_")[0] + streamKey.split("_").at(-1)
				? "/" + streamKey.split("_").at(-1)
				: "";

		console.log(resDir);

		const watcher = chokidar.watch(resDir, {
			ignored: /(^|[\/\\])\../,
			persistent: true,
			ignoreInitial: false,
		});

		const uploadHandler = debouncedUpload(async (filePath) => {
			console.log("filePath: " + filePath);
			await uploadFileToS3(filePath, s3Prefix + "/" + path.basename(filePath));
		}, 1500);

		watcher
			.on("add", (filePath) => uploadHandler(filePath))
			.on("change", (filePath) => uploadHandler(filePath));

		watchers.push(watcher);

		// Cleanup on stream end
		nms.on("donePublish", () => {
			watchers.forEach((watcher) => watcher.close());
		});
	} catch (error) {
		console.error("Stream processing error:", error);
	}
});

nms.run();
