import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUSPICIOUS_GIF_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'suspicious.gif');

const ZERO_PERCENT_USER_ID = '1042151837341601882';

function getSuspiciousPercent(userId) {
    if (userId === ZERO_PERCENT_USER_ID) {
        return 0;
    }
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash) % 101;
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
        try {
            await InteractionHelper.safeDefer(interaction);

            const targetUser = interaction.options.getUser('user');
            const percent = getSuspiciousPercent(targetUser.id);

            logger.info(`/suspicious: checking for gif at path: ${SUSPICIOUS_GIF_PATH}`);
            const fileExists = fs.existsSync(SUSPICIOUS_GIF_PATH);
            logger.info(`/suspicious: file exists = ${fileExists}`);

            const embed = createEmbed({
                title: 'Suspicious Activity Detected',
                description: `${targetUser} is **${percent}%** suspicious.`,
                color: 'warning',
            });

            if (fileExists) {
                const attachment = new AttachmentBuilder(SUSPICIOUS_GIF_PATH, { name: 'suspicious.gif' });
                embed.setThumbnail('attachment://suspicious.gif');
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [embed],
                    files: [attachment],
                });
            } else {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [embed],
                    content: `⚠️ GIF file not found at expected path: \`${SUSPICIOUS_GIF_PATH}\``,
                });
            }
        } catch (error) {
            logger.error('/suspicious command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                content: `⚠️ Error: ${error.message}`,
            }).catch(() => {});
        }
    },
};
