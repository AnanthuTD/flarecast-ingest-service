import { TOPICS } from "./topics";
import { logger } from "../logger";
import { createTopic } from "./admin";
import { consumeMessages } from "./consumer";

// Create topics and start consuming messages
createTopic(Object.values(TOPICS)).then(() => {
	logger.info("✅ Topic created successfully");

	// Define topic handlers
	const topicHandlers = {
		
	};

	// Start consuming messages
	consumeMessages(topicHandlers).catch((error) => {
		logger.error("Failed to start consumer:", error);
	});
});
