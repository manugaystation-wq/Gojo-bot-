import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { incrementSuspicious } from '../../services/suspiciousStore.js';

const SUSPICIOUS_GIF = 'https://media1.tenor.com/m/OlDmZILh6HIAAAAC/death-note-death-note-l.gif';

export default {
    data: new SlashCommandBuilder()
        .setName('suspicious')
        .setDescription('Mark someone as suspicious and track their growing count')
        .addUserOption((option) =>
            option.setName('user').setDescription('Who to suspect').setRequired(true),
        )
        .setDMPermission(false),
    category: 'Fun',

    async execute(interaction, guildConfig, client) {
        await InteractionHelper.safeDefer(interaction);

        const targetUser = interaction.options.getUser('user');

        const count = await incrementSuspicious(client, interaction.guild.id, targetUser.id);

        const embed = createEmbed({
            title: 'Suspicious Activity Detected',
            description: `${targetUser} has been marked suspicious.\n\n**Suspicious count:** ${count}`,
            color: 'warning',
        });
        embed.setImage(SUSPICIOUS_GIF);

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    },
};
