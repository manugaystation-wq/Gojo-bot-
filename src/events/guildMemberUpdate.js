// guildMemberUpdate.js
// NOTE: if your project already has a guildMemberUpdate event file, merge
// this logic into it instead of adding a second one — most bot frameworks
// only expect one handler per event name.

import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLockedName } from '../services/moderation/namelockStore.js';

export default {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember, client) {
        try {
            if (oldMember.nickname === newMember.nickname) {
                return; // nothing nickname-related changed
            }

            const lockedName = await getLockedName(client, newMember.guild.id, newMember.id);
            if (!lockedName) {
                return; // not locked
            }

            if (newMember.nickname === lockedName) {
                return; // already matches the lock, nothing to revert
            }

            await newMember.setNickname(lockedName, 'Reverting — nickname is locked').catch((error) => {
                logger.warn(`Failed to revert locked nickname for ${newMember.id} in guild ${newMember.guild.id}:`, error.message);
            });
        } catch (error) {
            logger.error('Error in guildMemberUpdate (namelock enforcement):', error);
        }
    },
};
