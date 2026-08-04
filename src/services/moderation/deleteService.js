// deleteService.js
// Temporarily strips a member's roles and sets their nickname to a fixed
// placeholder, then automatically restores everything after a set duration.
// State is persisted in the DB (temp: prefixed key, TTL-backed) so a bot
// restart during the punishment doesn't lose track of who needs restoring.

import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';

const DELETE_NICKNAME = 'DELETED';

// In-memory timers so restores fire immediately when due, without waiting
// for the next sweep. Rebuilt on startup via sweepExpiredDeletes.
const activeTimers = new Map(); // `${guildId}:${userId}` -> Timeout

function getKey(guildId, userId) {
    return `temp:deleted:${guildId}:${userId}`;
}

export function parseDuration(input) {
    const match = /^(\d+)\s*(s|m|h|d)$/i.exec(String(input).trim());
    if (!match) {
        return null;
    }
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return amount * multipliers[unit];
}

export async function applyDelete(client, guild, member, durationMs, moderatorId, reason) {
    if (!member.moderatable) {
        throw new TitanBotError(
            'Cannot moderate member',
            ErrorTypes.PERMISSION,
            "I can't modify that member (check role hierarchy — my role needs to be above theirs).",
        );
    }

    const originalRoleIds = member.roles.cache
        .filter((role) => role.id !== guild.id && !role.managed) // exclude @everyone and bot/booster-managed roles
        .map((role) => role.id);
    const originalNickname = member.nickname; // null if they had no custom nickname
    const restoreAt = Date.now() + durationMs;

    await client.db.set(
        getKey(guild.id, member.id),
        {
            originalRoleIds,
            originalNickname,
            restoreAt,
            moderatorId,
            reason: reason || null,
        },
        Math.ceil(durationMs / 1000) + 300, // TTL with a 5-minute safety buffer past the restore time
    );

    // Remove only the roles we recorded (leaves managed roles like boost/bot roles untouched).
    for (const roleId of originalRoleIds) {
        await member.roles.remove(roleId, `Deleted by ${moderatorId}${reason ? `: ${reason}` : ''}`).catch(() => {});
    }
    await member.setNickname(DELETE_NICKNAME, `Deleted by ${moderatorId}`).catch(() => {});

    scheduleRestore(client, guild.id, member.id, durationMs);
}

function scheduleRestore(client, guildId, userId, durationMs) {
    const timerKey = `${guildId}:${userId}`;
    if (activeTimers.has(timerKey)) {
        clearTimeout(activeTimers.get(timerKey));
    }
    const timeout = setTimeout(() => {
        restoreMember(client, guildId, userId).catch((error) => {
            logger.error(`Failed to auto-restore deleted member ${userId} in guild ${guildId}:`, error);
        });
        activeTimers.delete(timerKey);
    }, durationMs);
    activeTimers.set(timerKey, timeout);
}

export async function restoreMember(client, guildId, userId) {
    const key = getKey(guildId, userId);
    const data = await client.db.get(key);
    if (!data) {
        return false;
    }

    const guild = client.guilds.cache.get(guildId);
    if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
            for (const roleId of data.originalRoleIds || []) {
                await member.roles.add(roleId, 'Restoring roles — delete duration expired').catch(() => {});
            }
            await member.setNickname(data.originalNickname || null, 'Restoring nickname — delete duration expired').catch(() => {});
        }
    }

    await client.db.delete(key);

    const timerKey = `${guildId}:${userId}`;
    if (activeTimers.has(timerKey)) {
        clearTimeout(activeTimers.get(timerKey));
        activeTimers.delete(timerKey);
    }

    return true;
}

export async function isDeleted(client, guildId, userId) {
    const data = await client.db.get(getKey(guildId, userId));
    return Boolean(data);
}

// Run once on bot startup: restores anyone whose timer already expired while
// the bot was offline, and reschedules in-memory timers for anyone still pending.
export async function sweepExpiredDeletes(client) {
    for (const [guildId] of client.guilds.cache) {
        let keys = [];
        try {
            keys = await client.db.list(`temp:deleted:${guildId}:`);
        } catch (error) {
            logger.error(`Failed to list pending deletes for guild ${guildId}:`, error);
            continue;
        }

        for (const key of keys) {
            const data = await client.db.get(key).catch(() => null);
            if (!data) {
                continue;
            }
            const userId = key.split(':').pop();

            if (Date.now() >= data.restoreAt) {
                await restoreMember(client, guildId, userId).catch((error) => {
                    logger.error(`Failed to restore overdue delete for ${userId} in guild ${guildId}:`, error);
                });
            } else {
                scheduleRestore(client, guildId, userId, data.restoreAt - Date.now());
            }
        }
    }
}
