// sedseWarningStore.js
// Tracks last-played timestamp per guild for the "don't skip sedse's songs" warning,
// so it can only be triggered once every 60 seconds regardless of how many times
// people try to skip.

const COOLDOWN_MS = 60 * 1000;
const lastPlayed = new Map(); // guildId -> timestamp

export function canPlaySedseWarning(guildId) {
    const last = lastPlayed.get(guildId) || 0;
    return Date.now() - last >= COOLDOWN_MS;
}

export function markSedseWarningPlayed(guildId) {
    lastPlayed.set(guildId, Date.now());
}
