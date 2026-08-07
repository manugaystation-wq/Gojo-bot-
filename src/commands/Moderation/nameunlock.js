import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { unlockName } from '../../services/moderation/namelockStore.js';

const ALLOWED_USER_IDS = new Set(['1042151837341601882', '1065025564441850036']);

export default {
    data: new SlashCommandBuilder()
        .setName('nameunlock')
        .setDescription("Remove a member's nickname lock")
        .addUserOption((option) =>
            option.setName('user').setDescription('Member to unlock').setRequired(true),
        )
        .setDMPermission(false),
    category: 'moderation',

    async execute(interaction, guildConfig, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            return;
        }

        if (!ALLOWED_USER_IDS.has(interaction.user.id)) {
            return replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'This command is not available to you.',
            });
        }

        const targetUser = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        await unlockName(client, interaction.guild.id, targetUser.id);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    'Nickname Unlocked',
                    `${member ?? targetUser.tag} can now change their nickname freely again.`,
                ),
            ],
        });
    },
};
