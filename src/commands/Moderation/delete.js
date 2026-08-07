import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { applyDelete, parseDuration, isDeleted } from '../../services/moderation/deleteService.js';

const MIN_DURATION_MS = 10 * 1000; // 10 seconds
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ALLOWED_USER_ID = '1042151837341601882';

export default {
    data: new SlashCommandBuilder()
        .setName('delete')
        .setDescription("Temporarily strip a member's roles and nickname, restored automatically after a set time")
        .addUserOption((option) =>
            option.setName('user').setDescription('Member to delete').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('duration')
                .setDescription('How long, e.g. 10m, 2h, 1d (min 10s, max 30d)')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option.setName('reason').setDescription('Reason (optional)').setRequired(false),
        )
        .setDMPermission(false),
    category: 'moderation',

    async execute(interaction, guildConfig, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            return;
        }

        if (interaction.user.id !== ALLOWED_USER_ID) {
            return replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'This command is not available to you.',
            });
        }

        const targetUser = interaction.options.getUser('user');
        const durationInput = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason');

        const durationMs = parseDuration(durationInput);
        if (!durationMs || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
            return replyUserError(interaction, {
                type: ErrorTypes.VALIDATION,
                message: 'Invalid duration. Use a format like `10m`, `2h`, or `1d` (minimum 10s, maximum 30d).',
            });
        }

        if (targetUser.bot) {
            return replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'You cannot use this on bot accounts.' });
        }

        if (targetUser.id === interaction.user.id) {
            return replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: "You can't use this on yourself." });
        }

        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) {
            return replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: "Couldn't find that member in this server." });
        }

        const alreadyDeleted = await isDeleted(client, interaction.guild.id, member.id);
        if (alreadyDeleted) {
            return replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'That member is already deleted. Wait for it to expire, or restore them first.' });
        }

        try {
            await applyDelete(client, interaction.guild, member, durationMs, interaction.user.id, reason);
        } catch (error) {
            return replyUserError(interaction, {
                type: ErrorTypes.UNKNOWN,
                message: error.userMessage || 'Failed to delete that member.',
            });
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    'Justice Has Been Served',
                    `${member}'s name has been written down. Their identity is erased from this world for **${durationInput}**.\n\nThe god of this new world does not forgive.${reason ? `\n\n**Reason:** ${reason}` : ''}`,
                ),
            ],
        });
    },
};
