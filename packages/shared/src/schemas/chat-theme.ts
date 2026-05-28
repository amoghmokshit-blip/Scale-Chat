import { z } from 'zod';

export const ChatThemeEnum = z.enum(['default', 'midnight', 'forest', 'sunset']);
export type ChatTheme = z.infer<typeof ChatThemeEnum>;

export const CHAT_THEMES = ChatThemeEnum.options;

export const SetChatThemeSchema = z.object({
  theme: ChatThemeEnum.nullable(),
});
export type SetChatThemeBody = z.infer<typeof SetChatThemeSchema>;

export const SetChatThemeResponseSchema = z.object({
  theme: ChatThemeEnum.nullable(),
});
export type SetChatThemeResponse = z.infer<typeof SetChatThemeResponseSchema>;
