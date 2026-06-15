/**
 * VIP channel membership manager.
 * Handles creating invite links and kicking expired members.
 */

/**
 * Create a single-use, 10-minute invite link for the VIP channel.
 * @param {import('grammy').Bot} bot
 * @returns {Promise<string>} invite link
 */
export async function createVipInviteLink(bot) {
  const expiryTimestamp = Math.floor(Date.now() / 1000) + 10 * 60; // 10 minutes

  const link = await bot.api.createChatInviteLink(process.env.VIP_CHANNEL_ID, {
    member_limit: 1,
    expire_date: expiryTimestamp,
    name: `VIP-${Date.now()}`,
  });

  return link.invite_link;
}

/**
 * Remove a member from the VIP channel (ban then immediately unban = kick without block).
 * @param {import('grammy').Bot} bot
 * @param {string|number} telegramId
 */
export async function kickMember(bot, telegramId) {
  const id = Number(telegramId);
  if (!id || isNaN(id)) {
    throw new Error(`Invalid telegram_id: ${telegramId}`);
  }

  await bot.api.banChatMember(process.env.VIP_CHANNEL_ID, id);
  // Immediately unban so they can rejoin if they renew
  await bot.api.unbanChatMember(process.env.VIP_CHANNEL_ID, id, {
    only_if_banned: true,
  });

  console.log(`[manager] Kicked telegram_id ${id} from VIP channel`);
}

/**
 * Get the current member count of the VIP channel.
 * @param {import('grammy').Bot} bot
 */
export async function getVipMemberCount(bot) {
  const count = await bot.api.getChatMemberCount(process.env.VIP_CHANNEL_ID);
  return count;
}
