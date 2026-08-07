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
