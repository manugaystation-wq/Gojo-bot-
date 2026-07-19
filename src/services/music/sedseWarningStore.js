// sedseWarningStore.js
// Tracks last-played timestamp per guild for the "don't skip sedse's songs" warning,
// so it can only be triggered once every 60 seconds regardless of how many times
// people try to skip. Also tracks a pending "resume here" position so the protected
// track can pick back up exactly where it was interrupted.

const COOLDOWN_MS = 60 * 1000;
const lastPlayed = new Map(); // guildId -> timestamp
const pendingResume = new Map(); // guildId -> { identifier, positionMs }

export function canPlaySedseWarning(guildId) {
    const last = lastPlayed.get(guildId) || 0;
    return Date.now() - last >= COOLDOWN_MS;
}

export function markSedseWarningPlayed(guildId) {
    lastPlayed.set(guildId, Date.now());
}

export function setPendingResume(guildId, identifier, positionMs) {
    pendingResume.set(guildId, { identifier, positionMs });
}

// Returns the saved position if this track matches the pending resume entry,
// and clears the entry either way (one-shot).
export function consumePendingResume(guildId, identifier) {
    const entry = pendingResume.get(guildId);
    if (!entry) {
        return null;
    }
    pendingResume.delete(guildId);
    return entry.identifier === identifier ? entry.positionMs : null;
}
