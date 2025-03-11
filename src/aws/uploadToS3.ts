import fs from "fs/promises";
import path from "path";
import {
	PutObjectCommand,
	type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { env } from "process";
import { logger } from "../logger";
import s3Client from "./s3";

const BUCKET_NAME = env.AWS_S3_BUCKET_NAME;

export async function uploadDirectoryToS3(localDir: string, s3Path: string) {
	const files = await fs.readdir(localDir);
	const uploadPromises = files.map(async (file) => {
		const localFilePath = path.join(localDir, file);
		const s3FilePath = `${s3Path}/${file}`;
		await uploadFileToS3(localFilePath, s3FilePath);
	});
	await Promise.all(uploadPromises);
}

export async function uploadFileToS3(localFilePath: string, s3Key: string) {
	const fileContent = await fs.readFile(localFilePath);

	const params: PutObjectCommandInput = {
		Bucket: BUCKET_NAME,
		Key: s3Key,
		Body: fileContent,
		ContentType: getContentType(path.extname(s3Key)),
	};

	try {
		await s3Client.send(new PutObjectCommand(params));
		logger.info(`🟢 Uploaded ${localFilePath} to s3://${BUCKET_NAME}/${s3Key}`);
	} catch (error) {
		logger.error(`🔴 Error uploading ${s3Key}:`, error);
		throw error;
	}
}

function getContentType(extension: string): string {
	const normalizedExt = extension.startsWith(".")
		? extension.toLowerCase()
		: `.${extension.toLowerCase()}`;

	const typeMap: { [key: string]: string } = {
		".m3u8": "application/vnd.apple.mpegurl", // HLS playlist
		".ts": "video/mp2t", // HLS segment
		".mp4": "video/mp4", // MP4 video
		".flv": "video/x-flv", // FLV (e.g., RTMP persistence)
		".webm": "video/webm", // WebM video
	};

	return typeMap[normalizedExt] || "application/octet-stream";
}
