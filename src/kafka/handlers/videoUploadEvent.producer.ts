import { logger } from "../../logger";
import { sendMessage } from "../producer";
import { TOPICS } from "../topics";

export async function sendVideoUploadEvent(data: {
	s3Key: string;
	videoId: string;
	aiFeature: boolean;
	transcode: boolean;
	type: "LIVE";
	userId: string;
}) {
	logger.info(
		"Sending video upload event to kafka topic: " + TOPICS.VIDEO_UPLOAD_EVENT
	);
	const message = JSON.stringify(data);
	await sendMessage(TOPICS.VIDEO_UPLOAD_EVENT, message);
}
