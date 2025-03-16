import { logger } from "../logger";
import kafka from "./kafka";
import { TOPICS } from "./topics";
import { KafkaMessage } from "kafkajs";

const consumer = kafka.consumer({
  groupId: "transcode-group",
  allowAutoTopicCreation: true,
});

// Define the type for topic handlers
type TopicHandler = (
  value: any,
  topic: string,
  partition: number,
  message: KafkaMessage
) => void;

// Define the type for the topicHandlers object
type TopicHandlers = {
  [key in TOPICS]?: TopicHandler;
};

export async function consumeMessages(topicHandlers: TopicHandlers) {
  const topics = Object.keys(topicHandlers) as TOPICS[];

  logger.info("⌛ Consuming messages from topic(s):", topics);

  try {
    // Connect to the Kafka broker
    await consumer.connect();

    // Subscribe to the specified topics
    await consumer.subscribe({ topics });

    // Start consuming messages
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        logger.info({
          topic,
          partition,
          message: message.value?.toString(),
        });

        let { value } = message;

        if (value) {
          const parsedValue = JSON.parse(value.toString()) as object;

          // Get the handler for the current topic
          const handler = topicHandlers[topic as TOPICS];

          if (handler) {
            // Call the handler for the topic
            handler(parsedValue, topic, partition, message);
          } else {
            logger.warn(`No handler defined for topic: ${topic}`);
          }
        }
      },
    });
  } catch (error) {
    logger.error("🔴 Error consuming messages:", error);
  }
}