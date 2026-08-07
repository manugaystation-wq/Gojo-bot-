import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { lockName } from '../../services/moderation/namelockStore.js';

const ALLOWED_USER_ID = '1042151837341601882';
const ALLOWED_USER_ID = '1065025564441850036';

export default {
    data: new SlashCommandBuilder()
        .setName('namelock')
        .setDescription("Lock a member's nickname to a specific name until unlocked")
        .addUserOption((option) =>
            option.setName('user').setDescription('Member to lock').setRequired(true),
        )
        .addStringOption((option) =>
            option.setName('name').setDescription('Nickname to lock them to').setRequired(true).setMaxLength(32),
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
        const lockedName = interaction.options.getString('name');

        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) {
            return replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: "Couldn't find that member in this server." });
        }

        if (!member.manageable) {
            return replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: "I can't modify that member's nickname (check role hierarchy — my role needs to be above theirs).",
            });
        }

        await member.setNickname(lockedName, `Nickname locked by ${interaction.user.tag}`).catch(() => {});
        await lockName(client, interaction.guild.id, member.id, lockedName);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    'Nickname Locked',
                    `${member}'s nickname is now locked to **${lockedName}**. Any attempt to change it will be reverted automatically until \`/nameunlock\` is used.`,
                ),
            ],
        });
    },
};
