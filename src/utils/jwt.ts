import jwt from "jsonwebtoken";
import { logger } from "../logger";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key"; // Store in env

export interface StreamTokenPayload {
  id: string;
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