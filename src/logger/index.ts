import { createLogger, transports, format } from "winston";
import LokiTransport from "winston-loki";
import env from "../env";

const basicAuthentication = env.LOKI_USER_ID + ":" + env.LOKI_API_KEY;

// Custom format with emojis for console output
const emojiFormat = format.printf(({ timestamp, level, message }) => {
	const emojiMap: { [key: string]: string } = {
		debug: "🔍",
		info: "ℹ️",
		warn: "⚠️",
		error: "❌",
	};

	const emoji = emojiMap[level] || "📝";
	return `${timestamp} ${emoji} ${level.toUpperCase()}: ${message}`;
});

const options = {
	level: "debug",
	format: format.combine(
		format.timestamp(),
		format.json() // Base format for Loki
	),
	transports: [
		new LokiTransport({
			host: env.GRAFANA_HOST,
			labels: { app: "ingest-service" },
			json: true,
			basicAuth: basicAuthentication,
			replaceTimestamp: true,
			onConnectionError: (err) =>
				console.error(`❌ Loki Connection Error: ${err}`),
		}),
		new transports.Console({
			format: format.combine(
				format.colorize(),
				emojiFormat // Custom format with emojis for console
			),
		}),
	],
};

export const logger = createLogger(options);

export const streamLogger = {
  streamStart: (streamKey: string) => logger.info(`🎥 Stream started: ${streamKey}`),
  directoryCreated: (path: string) => logger.info(`📁 Directory created: ${path}`),
  fileWritten: (path: string) => logger.info(`📝 File written: ${path}`),
  s3Upload: (path: string) => logger.info(`☁️ Uploaded to S3: ${path}`),
  watchingFiles: (resolution: string) => logger.debug(`👀 Watching files for ${resolution}`),
  fileUploaded: (file: string) => logger.info(`⬆️ File uploaded: ${file}`),
  streamEnd: (streamKey: string) => logger.info(`🏁 Stream ended: ${streamKey}`),
  error: (message: string, error?: Error) => logger.error(`${message}${error ? `: ${error.message}` : ''}`),
};