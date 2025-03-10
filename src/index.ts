import NodeMediaServer from "node-media-server";
import { logger, streamLogger } from "./logger";
import { createDir, ensureDirectoryExists } from "./helpers/fs.helper";
import { createMasterPlaylist } from "./transcode";
import { mkdirSync, watch, writeFileSync } from "node:fs";
import { uploadFileToS3 } from "./aws/uploadToS3";
import path from "node:path";

const httpConfig = {
	port: 8000,
	allow_origin: "*",
	mediaroot: "./media",
};

const rtmpConfig = {
	port: 1935,
	chunk_size: 60000,
	gop_cache: true,
	ping: 10,
	ping_timeout: 60,
};

const transformationConfig = {
	ffmpeg: "/usr/bin/ffmpeg",
	tasks: [
		{
			app: "live",
			hls: true,
			hlsFlags: "[hls_time=2:hls_list_size=0:hls_flags=delete_segments]",
			hlsKeep: true,
		},
	],
	MediaRoot: "./media",
};

const config = {
	http: httpConfig,
	rtmp: rtmpConfig,
	trans: transformationConfig,
};

const nms = new NodeMediaServer(config);

nms.on("preConnect", (id, args) => {
	console.log(
		"[NodeEvent on preConnect]",
		`id=${id} args=${JSON.stringify(args)}`
	);
});

nms.on("postConnect", (id, args) => {
	console.log(
		"[NodeEvent on postConnect]",
		`id=${id} args=${JSON.stringify(args)}`
	);
});

nms.on("doneConnect", (id, args) => {
	console.log(
		"[NodeEvent on doneConnect]",
		`id=${id} args=${JSON.stringify(args)}`
	);
});

nms.on("prePublish", (id, StreamPath, args) => {
	console.log(
		"[NodeEvent on prePublish]",
		`id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`
	);
});

nms.on("postPublish", async (id, streamPath) => {
	try {
		const streamKey = streamPath.split("/").pop();
		if (!streamKey) {
			streamLogger.error(
				"Invalid stream path",
				new Error(`Path: ${streamPath}`)
			);
			return;
		}

		const hlsBaseDir = path.join(process.cwd(), `media/live/${streamKey}`);
		logger.debug("hlsBaseDir: " + hlsBaseDir);
		createDir(hlsBaseDir);
		streamLogger.directoryCreated(hlsBaseDir);

		const resolutions = [1080, 720, 480];
		const masterPlaylistContent = createMasterPlaylist(
			`live/${streamKey}`,
			resolutions
		);
		const masterPlaylistPath = path.join(hlsBaseDir, "master.m3u8");

		/* writeFileSync(`./media/live/${streamKey}/master.m3u8`, masterPlaylistContent);
		streamLogger.fileWritten(masterPlaylistPath);

		await uploadFileToS3(masterPlaylistPath, `live/${streamKey}/master.m3u8`);
		streamLogger.s3Upload(`live/${streamKey}/master.m3u8`);

		resolutions.forEach(async (res) => {
			const hlsDir = path.join(hlsBaseDir, String(res));
			await createDir(hlsDir);
			streamLogger.watchingFiles(`${res}p`);

			const uploadDebounced = debounce(async (filePath, res, filename) => {
				await uploadFileToS3(filePath, `live/${streamKey}/${res}p/${filename}`);
				streamLogger.fileUploaded(`${res}p/${filename}`);
			}, 1000);

			watch(hlsDir, async (eventType, filename) => {
				if (
					!filename ||
					(!filename.endsWith(".ts") && !filename.endsWith(".m3u8"))
				)
					return;

				const filePath = path.join(hlsDir, filename);
				uploadDebounced(filePath, res, filename);
			});
		}); */
	} catch (error) {
		streamLogger.error("Stream processing failed", error);
	}
});

nms.on("donePublish", (id, StreamPath, args) => {
	console.log(
		"[NodeEvent on donePublish]",
		`id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`
	);
});

nms.on("prePlay", (id, StreamPath, args) => {
	console.log(
		"[NodeEvent on prePlay]",
		`id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`
	);
});

nms.on("postPlay", (id, StreamPath, args) => {
	console.log(
		"[NodeEvent on postPlay]",
		`id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`
	);
});

nms.on("donePlay", (id, StreamPath, args) => {
	console.log(
		"[NodeEvent on donePlay]",
		`id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`
	);
});

function debounce(func, delay) {
	let timeout;
	return (...args) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => func(...args), delay);
	};
}

nms.run();
