import NodeMediaServer from "node-media-server";
import chokidar from "chokidar";
import { uploadFileToS3 } from "./aws/uploadToS3";
import path from "path";
import { createDir } from "./helpers/fs.helper";
import { createMasterPlaylist } from "./transcode";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import env from "./env";
import { logger } from "./logger";
import { ChildProcess, spawn } from "child_process";
import fs from "fs";

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
		ffmpeg: env.FFMPEG_LOCATION,
		tasks: [
			{
				app: "game",
				hls: true,
				hlsFlags: "[hls_time=2:hls_list_size=0:hls_flags=delete_segments]",
				hlsKeep: true,
				// mp4: true,
				// mp4Flags: "[movflags=frag_keyframe+empty_moov]",
			},
		],
	},
	fission: {
		ffmpeg: env.FFMPEG_LOCATION,
		tasks: [
			{
				rule: "game/*",
				model: [
					{
						ab: "128k",
						vb: "3000k",
						vs: "1920x1080",
						vf: "60",
					},
					{ ab: "128k", vb: "1500k", vs: "1280x720", vf: "30" },
					{ ab: "96k", vb: "1000k", vs: "854x480", vf: "24" },
					{ ab: "96k", vb: "600k", vs: "640x360", vf: "20" },
				],
			},
		],
	},
};

const nms = new NodeMediaServer(config);

nms.on("postPublish", async (id, streamPath, args) => {
	let ffmpegProcess: null | ChildProcess = null;

	const watchers = [];
	const streamKey = streamPath.split("/").pop()?.split("_")[0];
	const resolution = streamPath.split("/").pop()?.split("_")?.[1] ?? null;

	if (!streamKey) {
		logger.error("Invalid stream path: ", streamPath);
		return;
	}
	const isInitial = streamPath.split("/").pop()?.split("_").length === 1;

	const hlsBaseDir = path.join(
		process.cwd(),
		`media/game/${streamPath.split("/").pop()}`
	);

	try {
		await createDir(hlsBaseDir);

		if (isInitial) {
			// Create master playlist and upload
			const masterContent = createMasterPlaylist(streamKey, [1080, 720, 480]);
			const masterPath = path.join(hlsBaseDir, "master.m3u8");
			writeFileSync(masterPath, masterContent);
			await uploadFileToS3(masterPath, `${streamKey}/master.m3u8`);
		}

		if (!isInitial) {
			// Setup file watcher for HLS
			const resDir = path.join(hlsBaseDir);
			const s3Prefix = streamKey + (resolution ? `/${resolution}` : "");

			const watcher = chokidar.watch(resDir, {
				ignored: /(^|[\/\\])\..|\.mp4$/,
				persistent: true,
				ignoreInitial: false,
			});

			const uploadHandler = async (filePath) => {
				logger.info("Uploading:", filePath);
				try {
					await uploadFileToS3(
						filePath,
						`${s3Prefix}/${path.basename(filePath)}`
					);
					unlinkSync(filePath); // Only remove if upload succeeds
				} catch (error) {
					logger.error("Failed to upload file:", filePath, error);
					console.error(error);
				}
			};

			watcher.on("add", uploadHandler).on("change", uploadHandler);
			watchers.push(watcher);
		}

		if (isInitial) {
			// WebM recording setup
			const customWebmName = "original.webm";
			const webmFilePath = path.join(hlsBaseDir, customWebmName);

			logger.info("Starting WebM recording for:", streamKey);

			const ffmpegArgs = [
				"-i",
				`rtmp://localhost:1935/game/stream`,
				"-c:v",
				"libvpx-vp9",
				"-b:v",
				"2M",
				"-c:a",
				"libopus",
				"-b:a",
				"128k",
				"-f",
				"webm",
				webmFilePath,
			];

			ffmpegProcess = spawn(env.FFMPEG_LOCATION, ffmpegArgs);

			ffmpegProcess.stdout?.on("data", (data) =>
				logger.info(`FFmpeg stdout: ${data}`)
			);
			ffmpegProcess.stderr?.on("data", (data) =>
				logger.error(`FFmpeg stderr: ${data}`)
			);

			ffmpegProcess.on("close", async (code) => {
				if (code === 0) {
					logger.info(`WebM file saved successfully: ${webmFilePath}`);
					await uploadFileToS3(webmFilePath, `${streamKey}/original.webm`);
					fs.rmSync(hlsBaseDir, { recursive: true, force: true }); // Cleanup
				} else {
					logger.error(`FFmpeg exited with error code ${code}`);
				}
			});
		}
	} catch (error) {
		logger.error("Stream processing error:", error);
	} finally {
		nms.on("donePublish", async (id, streamPath) => {
			logger.info("Stream processing done:", streamKey);

			// Stop watchers
			watchers.forEach((watcher) => watcher.close());
		});
	}
});

nms.run();
