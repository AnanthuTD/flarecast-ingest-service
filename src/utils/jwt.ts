import jwt from "jsonwebtoken";
import { logger } from "../logger";
import env from "../env";

const JWT_SECRET = env.LIVESTREAM_SECRET || "your-secret-key";

export interface StreamTokenPayload {
	id: string;
	type: "LIVE";
	workspaceId: string;
	userId: string;
	iat?: number;
	exp?: number;
}

export const verifyStreamToken = (token: string): StreamTokenPayload | null => {
	try {
		const decoded = jwt.verify(token, JWT_SECRET) as StreamTokenPayload;
		if (!decoded.id) throw new Error("Missing userId in token");
		return decoded;
	} catch (error) {
		logger.error("JWT verification failed:", error.message);
		return null;
	}
};
