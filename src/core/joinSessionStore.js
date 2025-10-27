// src/core/joinSessionStore.js
export const joinSessions = new Map();

export function isJoinInProgress(chatId) {
  return joinSessions.has(chatId);
}
