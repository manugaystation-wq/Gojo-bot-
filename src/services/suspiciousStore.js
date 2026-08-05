// suspiciousStore.js
// Tracks a persistent "suspicious count" per user, per guild.

function getKey(guildId, userId) {
    return `temp:suspicious:${guildId}:${userId}`;
}

const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;

export async function incrementSuspicious(client, guildId, userId) {
    const key = getKey(guildId, userId);
    const current = (await client.db.get(key)) || 0;
    const next = current + 1;
    await client.db.set(key, next, TEN_YEARS_SECONDS);
    return next;
}

export async function getSuspiciousCount(client, guildId, userId) {
    const key = getKey(guildId, userId);
    return (await client.db.get(key)) || 0;
}
