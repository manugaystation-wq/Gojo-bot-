export const VOICE_CHANNEL_DENIAL =
    'You need to be in the same voice channel as the bot to use music controls.';

export const REQUESTER_ONLY_DENIAL =
    'Only the person who requested this track can control playback.';

export function canControlMusic(member, player) {
    const memberChannel = member?.voice?.channel;
    if (!memberChannel || !player?.voiceChannel) {
        return false;
    }
    if (memberChannel.id !== player.voiceChannel) {
        return false;
    }

    const requesterId = player.current?.info?.requester?.id;
    if (requesterId && member.id !== requesterId) {
        return false;
    }

    return true;
}

export function requireVoiceChannel(member) {
    return Boolean(member?.voice?.channel);
}
