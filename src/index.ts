import NodeMediaServer from "node-media-server";
import chokidar, { FSWatcher } from "chokidar";
import { uploadFileToS3 } from "./aws/uploadToS3";
import path from "path";
import { createDir } from "./helpers/fs.helper";
import { createMasterPlaylist } from "./transcode";
import { writeFileSync, unlinkSync, existsSync } from "fs";
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
					// { ab: "128k", vb: "3000k", vs: "1920x1080", vf: "60" },
					// { ab: "128k", vb: "1500k", vs: "1280x720", vf: "30" },
					// { ab: "96k", vb: "1000k", vs: "854x480", vf: "24" },
					// { ab: "96k", vb: "600k", vs: "640x360", vf: "20" },
				],
			},
		],
	},
};

const nms = new NodeMediaServer(config);

// Store userId per session
interface SessionData {
	userId: string;
}
const sessions = new Map<string, SessionData>();

/* nms.on("prePublish", (id: string, args: string) => {
	console.log(`[NodeMediaServer] on prePublish`, id, args);
	const pathParts = args.split("?");
	const streamKey = pathParts[0].split("/").pop();
	const queryParams = new URLSearchParams(pathParts[1] || "");
	const token = queryParams.get("token")?.split("/")[0];; 

	console.log(`[AUTH] Checking streamKey: ${streamKey} with token: ${token}`);
	if (!token) {
		logger.error("No token provided for stream:", args);
		const session = nms.getSession(id);
		session?.reject();
		return;
	}

	// const payload = verifyStreamToken(token);
	const {data} = axios.get(`${env.VIDEO_SERVICE}/api/interservice/`)
	if (!payload || !payload.id || !payload.userId) {
		logger.error("Invalid or expired token for stream:", args);
		const session = nms.getSession(id);
		session?.reject();
		return;
	}

	// Store userId for this session
	sessions.set(id, payload);
	logger.info(`Authenticated stream ${args} for user ${payload.id}`);
}); */

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

			const masterContent = createMasterPlaylist(streamKey, [1080, 720, 480]);
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

		if (isInitial) {
			const customWebmName = "original.webm";
			const webmFilePath = path.join(hlsBaseDir, customWebmName);

			logger.info("Starting WebM recording for:", streamKey);

			const ffmpegArgs = [
				"-rtmp_live",
				"live",
				"-i",
				`rtmp://localhost:1935/game/${streamKey}`,
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
				"-flush_packets",
				"1",
				"-y",
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
					const s3Key = `${streamKey}/original.webm`;
					await uploadFileToS3(webmFilePath, s3Key);
					sendVideoUploadEvent({
						s3Key,
						videoId: streamKey,
						aiFeature: true,
						transcode: true,
					});
					if (existsSync(hlsBaseDir))
						fs.rmSync(hlsBaseDir, { recursive: true, force: true });
				} else {
					logger.error(`FFmpeg exited with error code ${code}`);
					sendMessage(
						TOPICS.LIVE_STREAM_EVENT,
						JSON.stringify({
							videoId: streamKey,
							status: "FAILED",
							error: `FFmpeg exited with code ${code}`,
						})
					);
				}
				ffmpegProcess = null;
			});
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

	nms.on("donePublish", async (id: string, streamPath: string) => {
		logger.info("Stream processing done:", streamKey);
		watchers.forEach((watcher) => watcher.close());

		/* if (existsSync(hlsBaseDir)) {
			fs.rmSync(hlsBaseDir, { recursive: true, force: true });
		} */
			sendMessage(
			TOPICS.LIVE_STREAM_EVENT,
			JSON.stringify({
				videoId: streamKey,
				status: "SUCCESS",
			})
		);
		sessions.delete(id);
	});
});

nms.run();
