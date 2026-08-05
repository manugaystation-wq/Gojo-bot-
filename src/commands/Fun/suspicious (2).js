import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const SUSPICIOUS_GIF = 'https://media1.tenor.com/m/OlDmZILh6HIAAAAC/death-note-death-note-l.gif';

// Deterministic percentage based on the user's ID — always the same result
// for the same person, no randomness and no persistence needed.
function getSuspiciousPercent(userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash) % 101; // 0-100
}

export default {
    data: new SlashCommandBuilder()
        .setName('suspicious')
        .setDescription('Check how suspicious someone is')
        .addUserOption((option) =>
            option.setName('user').setDescription('Who to check').setRequired(true),
        )
        .setDMPermission(false),
    category: 'Fun',

    async execute(interaction, guildConfig, client) {
        await InteractionHelper.safeDefer(interaction);

        const targetUser = interaction.options.getUser('user');
        const percent = getSuspiciousPercent(targetUser.id);

        const embed = createEmbed({
            title: 'Suspicious Activity Detected',
            description: `${targetUser} is **${percent}%** suspicious.`,
            color: 'warning',
        });
        embed.setImage(SUSPICIOUS_GIF);

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    },
};
