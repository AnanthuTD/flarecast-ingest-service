import NodeMediaServer from "node-media-server";
import chokidar, { FSWatcher } from "chokidar";
import { uploadFileToS3 } from "./aws/uploadToS3";
import path from "path";
import { createDir } from "./helpers/fs.helper";
import { createMasterPlaylist } from "./transcode";
import { writeFileSync, unlinkSync, existsSync, readdirSync } from "fs";
import env from "./env";
import { logger } from "./logger";
import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import { sendMessage } from "./kafka/producer";
import { TOPICS } from "./kafka/topics";
import { sendVideoUploadEvent } from "./kafka/handlers/videoUploadEvent.producer";

const config = {
	rtmp: {
		port: 1935,
		chunk_size: 60000,
		gop_cache: true,
		ping: 30,
		ping_timeout: 60,
	},
	http: { port: 8000, mediaroot: "./media", allow_origin: "*" },
	trans: {
		ffmpeg: env.FFMPEG_LOCATION,
		tasks: [
			{
				app: "game",
				hls: true,
				hlsFlags: "[hls_time=2:hls_list_size=0:hls_flags=delete_segments]",
				hlsKeep: true,
				mp4: true,
				mp4Flags: "[movflags=frag_keyframe+empty_moov]",
			},
		],
	},
	fission: {
		ffmpeg: env.FFMPEG_LOCATION,
		tasks: [
			{
				rule: "game/*",
				model: [
					// { ab: "128k", vb: "3000k", vs: "1920x1080", vf: "60" },
					{ ab: "128k", vb: "1500k", vs: "1280x720", vf: "30" },
					// { ab: "96k", vb: "1000k", vs: "854x480", vf: "24" },
					// { ab: "96k", vb: "600k", vs: "640x360", vf: "20" },
				],
			},
		],
	},
};

const nms = new NodeMediaServer(config);

const sessions = new Map();

nms.on("postPublish", async (id: string, streamPath: string) => {
	let ffmpegProcess: ChildProcess | null = null;
	const watchers: FSWatcher[] = [];
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
			sendMessage(
				TOPICS.LIVE_STREAM_EVENT,
				JSON.stringify({
					videoId: streamKey,
					status: "PROCESSING",
				})
			);

			const masterContent = createMasterPlaylist(streamKey, [720]);
			const masterPath = path.join(hlsBaseDir, "master.m3u8");
			writeFileSync(masterPath, masterContent);
			await uploadFileToS3(masterPath, `${streamKey}/master.m3u8`);
		}

		if (!isInitial) {
			const resDir = path.join(hlsBaseDir);
			const s3Prefix = streamKey + (resolution ? `/${resolution}` : "");

			const watcher = chokidar.watch(resDir, {
				ignored: /(^|[\/\\])\..|\.mp4$/,
				persistent: true,
				ignoreInitial: false,
			});

			const uploadHandler = async (filePath: string) => {
				logger.info("Uploading:", filePath);
				try {
					await uploadFileToS3(
						filePath,
						`${s3Prefix}/${path.basename(filePath)}`
					);
					// unlinkSync(filePath);
				} catch (error) {
					logger.error("Failed to upload file:", filePath, error);
					console.error(error);
				}
			};

			watcher.on("add", uploadHandler).on("change", uploadHandler);
			watchers.push(watcher);
		}
	} catch (error) {
		logger.error("Stream processing error:", error);
		sendMessage(
			TOPICS.LIVE_STREAM_EVENT,
			JSON.stringify({
				videoId: streamKey,
				status: "FAILED",
				error: (error as Error).message || "Stream processing error",
			})
		);
	}

	nms.on("donePublish", async (doneId: string, doneStreamPath: string) => {
		if (id !== doneId) return;
		logger.info("Stream processing done:", streamKey);

		watchers.forEach((watcher) => watcher.close());

		if (!isInitial) return;

		sendMessage(
			TOPICS.LIVE_STREAM_EVENT,
			JSON.stringify({
				videoId: streamKey,
				status: "SUCCESS",
			})
		);

		try {
			// Find the first MP4 file in the initial stream directory
			const initialDir = path.join(process.cwd(), `media/game/${streamKey}`);
			let mp4FilePath = null;
			if (existsSync(initialDir)) {
				const files = readdirSync(initialDir);
				mp4FilePath = files.find((file) => file.endsWith(".mp4"));
				if (mp4FilePath) {
					mp4FilePath = path.join(initialDir, mp4FilePath);
				}
			}

			if (mp4FilePath && existsSync(mp4FilePath)) {
				/* const webmFilePath = path.join(initialDir, `${streamKey}.webm`);
				logger.info(`Converting ${mp4FilePath} to WebM...`);

				// Convert MP4 to WebM
				await new Promise((resolve, reject) => {
					const ffmpeg = spawn(
						env.FFMPEG_LOCATION,
						[
							"-i",
							mp4FilePath,
							"-c:v",
							"libvpx-vp9",
							"-b:v",
							"1500k",
							"-c:a",
							"libopus",
							"-b:a",
							"128k",
							"-f",
							"webm",
							webmFilePath,
						],
						{ stdio: "inherit" }
					);

					ffmpeg.on("close", (code) => {
						if (code === 0) {
							logger.info(`Converted ${mp4FilePath} to ${webmFilePath}`);
							resolve(null);
						} else {
							reject(new Error(`FFmpeg exited with code ${code}`));
						}
					});

					ffmpeg.on("error", (err) => reject(err));
				}); */

				const s3Key = `${streamKey}/original.mp4`;

				// Upload WebM to S3
				await uploadFileToS3(mp4FilePath, s3Key);
				logger.info(
					`Uploaded ${mp4FilePath} to S3 as ${streamKey}/original.webm`
				);

				sendVideoUploadEvent({
					s3Key,
					videoId: streamKey,
					aiFeature: true,
					transcode: true,
					type:"LIVE"
				});

				// Optional cleanup
				// unlinkSync(mp4FilePath);
				// unlinkSync(webmFilePath);
			} else {
				logger.warn(`No MP4 file found in ${initialDir}`);
			}
		} catch (error) {
			logger.error("Post-stream processing error:", error);
			sendMessage(
				TOPICS.LIVE_STREAM_EVENT,
				JSON.stringify({
					videoId: streamKey,
					status: "FAILED",
					error: (error as Error).message || "Post-stream processing error",
				})
			);
		}

		// Optional directory cleanup
		if (existsSync(hlsBaseDir)) {
			fs.rmSync(hlsBaseDir, { recursive: true, force: true });
		}
		sessions.delete(id);
	});
});

nms.run();
