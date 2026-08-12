import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const ZERO_PERCENT_USER_ID = '1042151837341601882';
const CONFIRMED_KIRA_USER_ID = '1025636761533169674';

// Deterministic percentage based on the user's ID — always the same result
// for the same person, no randomness and no persistence needed.
function getSuspiciousPercent(userId) {
    if (userId === ZERO_PERCENT_USER_ID) {
        return 0;
    }
    if (userId === CONFIRMED_KIRA_USER_ID) {
        return 100;
    }
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

        const description = targetUser.id === CONFIRMED_KIRA_USER_ID
            ? `I knew it from the start... **${targetUser}**, you are Kira. **${percent}%** certain.`
            : `Hm... Based on my analysis, there is a **${percent}%** probability that ${targetUser} is Kira.`;

        const embed = createEmbed({
            title: "L's Deduction",
            description,
            color: 'warning',
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    },
};
