/** Keep the transient chat window and its moderation buckets across hibernation.
 * These are room-local state, separate from an owner's optional history archive.
 */
export function idleChatSnapshot(table) {
  const room=table.room;
  if(!room)return null;
  return structuredClone({
    at:Date.now(),log:room.chatLog,buckets:room.chatBuckets,address:room.chatAddress,reacts:room.chatReacts,
    stats:Object.fromEntries(Object.entries(room.stats).filter(([key])=>key.startsWith('chat'))),
    sent:table.chatSent,pending:table.chatPend,
  });
}
export function restoreIdleChat(table,saved) {
  if(!saved||!table.room)return;
  table.room.chatLog=saved.log??[];
  table.room.chatBuckets=saved.buckets??new Map();
  table.room.chatAddress=saved.address??new Map();
  table.room.chatReacts=saved.reacts??[];
  Object.assign(table.room.stats,saved.stats??{});
  table.chatSent=saved.sent??table.chatSent;
  table.chatPend=saved.pending??table.chatPend;
}
