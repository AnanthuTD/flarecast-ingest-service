import { TOPICS } from "./topics";
import kafka from "./kafka";
import { logger } from "../logger";

const admin = kafka.admin();

export async function createTopic(topics: TOPICS[]) {
	try {
		await admin.connect();

		const metadata = await admin.fetchTopicMetadata();
		const existingTopics = new Set(metadata.topics.map((topic) => topic.name));

		for (const topicName of topics) {
			logger.info(`⏳ Checking if topic exists: ${topicName}`);

			if (existingTopics.has(topicName)) {
				logger.info(`✅ Topic "${topicName}" already exists.`);
			} else {
				logger.info(`⏳ Topic "${topicName}" does not exist. Creating it...`);
				try {
					await admin.createTopics({
						topics: [
							{
								topic: topicName,
								numPartitions: 1,
								replicationFactor: 1, 
							},
						],
					});
					logger.info(`✅ Topic "${topicName}" created.`);
				} catch (error) {
					logger.error(`🔴 Error creating topic "${topicName}":`, error);
				}
			}
		}
	} catch (error) {
		logger.error("🔴 Error processing topics:", error);
	} finally {
		try {
			await admin.disconnect();
		} catch (disconnectError) {
			logger.error("🔴 Error disconnecting Kafka admin:", disconnectError);
		}
	}
}
