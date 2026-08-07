// namelockStore.js
// Persists which members have a locked nickname, per guild, so the lock
// survives bot restarts. Stored via the generic temp-key store with a very
// long TTL (effectively permanent) since there's no dedicated table for this.

const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;

function getKey(guildId, userId) {
    return `temp:namelock:${guildId}:${userId}`;
}

export async function lockName(client, guildId, userId, lockedName) {
    await client.db.set(getKey(guildId, userId), { lockedName }, TEN_YEARS_SECONDS);
}

export async function unlockName(client, guildId, userId) {
    await client.db.delete(getKey(guildId, userId));
}

export async function getLockedName(client, guildId, userId) {
    const data = await client.db.get(getKey(guildId, userId));
    return data?.lockedName ?? null;
}

const ENFORCEMENT_INTERVAL_MS = 10 * 1000;
let enforcementInterval = null;

// Periodically re-checks every locked member across every guild and reverts
// their nickname if it drifted — a backstop against another bot (or anything
// else) winning the instant-revert race on a given change.
export function startNamelockEnforcement(client) {
    if (enforcementInterval) {
        return; // already running
    }

    enforcementInterval = setInterval(async () => {
        try {
            for (const [guildId, guild] of client.guilds.cache) {
                const keys = await client.db.list(`temp:namelock:${guildId}:`).catch(() => []);
                for (const key of keys) {
                    const data = await client.db.get(key).catch(() => null);
                    if (!data?.lockedName) {
                        continue;
                    }

                    const userId = key.split(':').pop();
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (!member) {
                        continue;
                    }

                    if (member.nickname !== data.lockedName) {
                        await member.setNickname(data.lockedName, 'Nickname lock re-enforced').catch(() => {});
                    }
                }
            }
        } catch {
            // never let the enforcement loop itself crash anything
        }
    }, ENFORCEMENT_INTERVAL_MS);
}

export function stopNamelockEnforcement() {
    if (enforcementInterval) {
        clearInterval(enforcementInterval);
        enforcementInterval = null;
    }
}
