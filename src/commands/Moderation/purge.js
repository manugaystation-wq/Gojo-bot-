import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

const MAX_PURGE_AMOUNT = 500;
const BATCH_SIZE = 100; // Discord's hard cap per bulkDelete call
const BATCH_DELAY_MS = 1000; // small pause between batches to avoid rate limits

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default {
    data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete a specific amount of messages")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription(`Number of messages (1-${MAX_PURGE_AMOUNT})`)
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_PURGE_AMOUNT),
    )
.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  category: "moderation",
  abuseProtection: { maxAttempts: 5, windowMs: 60_000 },
  async execute(interaction, config, client) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction, {
      flags: MessageFlags.Ephemeral,
    });
    if (!deferSuccess) {
      logger.warn(`Purge interaction defer failed`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'purge'
      });
      return;
    }
    const amount = interaction.options.getInteger("amount");
    const channel = interaction.channel;
    if (amount < 1 || amount > MAX_PURGE_AMOUNT)
      return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: `Please specify a number between 1 and ${MAX_PURGE_AMOUNT}.` });
    try {
      let totalDeleted = 0;
      let remaining = amount;
      let hitOldMessageWall = false;

      while (remaining > 0) {
        const batchLimit = Math.min(remaining, BATCH_SIZE);
        const fetched = await channel.messages.fetch({ limit: batchLimit });

        if (fetched.size === 0) {
          break; // nothing left to delete
        }

        const deleted = await channel.bulkDelete(fetched, true); // true = filter out messages >14 days old
        totalDeleted += deleted.size;
        remaining -= batchLimit;

        if (deleted.size < fetched.size) {
          // Some fetched messages were too old to bulk delete — further
          // batches will only get older, so stop here.
          hitOldMessageWall = true;
          break;
        }

        if (fetched.size < batchLimit) {
          break; // ran out of messages in the channel
        }

        if (remaining > 0) {
          await delay(BATCH_DELAY_MS);
        }
      }

      const deletedCount = totalDeleted;
      await logEvent({
        client,
        guild: interaction.guild,
        event: {
          action: "Messages Purged",
          target: `${channel} (${deletedCount} messages)`,
          executor: `${interaction.user.tag} (${interaction.user.id})`,
          reason: `Deleted ${deletedCount} messages`,
          metadata: {
            channelId: channel.id,
            messageCount: deletedCount,
            requestedAmount: amount,
            moderatorId: interaction.user.id
          }
        }
      });

      // Public, visible note in the channel itself showing who ran the purge —
      // the ephemeral reply below only the moderator sees, and it auto-deletes.
      const publicNotice = await channel.send({
        content: `🧹 **${deletedCount}** message(s) purged by ${interaction.user}.`,
      }).catch((error) => {
        logger.debug('Failed to send public purge notice:', error.message);
        return null;
      });
      if (publicNotice) {
        setTimeout(() => {
          publicNotice.delete().catch(() => {});
        }, 8000);
      }

      const noteSuffix = hitOldMessageWall
        ? ' Stopped early — remaining messages are older than 14 days and cannot be bulk deleted.'
        : '';

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          successEmbed(
            "Messages Purged",
            `Deleted ${deletedCount} messages in ${channel}.${noteSuffix}`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      setTimeout(() => {
        interaction.deleteReply().catch(err => 
          logger.debug('Failed to auto-delete purge response:', err)
        );
      }, 3000);
    } catch (error) {
      logger.error('Purge command error:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'An unexpected error occurred during message deletion. Note: Messages older than 14 days cannot be bulk deleted.' });
    }
  }
};
