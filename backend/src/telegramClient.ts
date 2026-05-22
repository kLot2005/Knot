import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { config } from "./config";

const session = new StringSession(config.sessionString);
export const telegramClient = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
});
