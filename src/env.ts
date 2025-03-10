import { cleanEnv, str, port, url } from "envalid";

const env = cleanEnv(process.env, {
	NODE_ENV: str({
		choices: ["development", "test", "production", "staging"],
	}),
	PORT: port(),
	DATABASE_URL: url(),
	ELECTRON_HOST: url(),
	FFMPEG_LOCATION: str(),
	COLLABORATION_API_URL: url(),
	GEMINI_API_KEY: str(),
	ACCESS_TOKEN_SECRET: str(),
	KAFKA_BROKER: str(),
	HUGGINGFACE_TOKEN: str(),
	GRAFANA_HOST: str(),
	LOKI_API_KEY: str(),
	LOKI_USER_ID: str(),
	AWS_CLOUDFRONT_URL: str(),  
	AWS_REGION: str(),
	AWS_ACCESS_KEY_ID: str(),
	AWS_SECRET_ACCESS_KEY: str(),
	AWS_S3_BUCKET_NAME: str(),
});

export default env;
