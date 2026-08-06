import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local file bundled with the project — put suspicious.gif in an `assets/`
// folder at your project root (same level as src/).
const SUSPICIOUS_GIF_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'suspicious.gif');

// Always shows 0% for this specific user ID, regardless of the hash.
const ZERO_PERCENT_USER_ID = '1042151837341601882';

// Deterministic percentage based on the user's ID — always the same result
// for the same person, no randomness and no persistence needed.
function getSuspiciousPercent(userId) {
    if (userId === ZERO_PERCENT_USER_ID) {
        return 0;
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

        const attachment = new AttachmentBuilder(SUSPICIOUS_GIF_PATH, { name: 'suspicious.gif' });

        const embed = createEmbed({
            title: 'Suspicious Activity Detected',
            description: `${targetUser} is **${percent}%** suspicious.`,
            color: 'warning',
            thumbnail: 'attachment://suspicious.gif',
        });

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed],
            files: [attachment],
        });
    },
};
