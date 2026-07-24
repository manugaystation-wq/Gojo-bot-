import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getGuildMusicData, clearUpdateInterval } from './playerStore.js';
import { canControlMusic, requireVoiceChannel, VOICE_CHANNEL_DENIAL, REQUESTER_ONLY_DENIAL } from './permissions.js';
import {
    buildNowPlayingEmbed,
    buildQueueEmbed,
    buildQueuePaginationRow,
    getQueuePageSize,
} from './musicEmbeds.js';
import { refreshPlayerMessage } from './playerHandler.js';
import {
    canPlaySedseWarning,
    markSedseWarningPlayed,
    setPendingResume,
} from './sedseWarningStore.js';

const YOUTUBE_URL_PATTERN = /(?:youtube\.com|youtu\.be)/i;

const SEDSE_USER_ID = '1025636761533169674';
const SEDSE_WARNING_AUDIO_URL = 'https://cdn.discordapp.com/attachments/1042518825855357001/1528426923359994048/ATOMIC-2026-07-19-17-41-dont-you-dare-skip-sedses-songs-if-you-do-it-ag.mp3?ex=6a5e41ff&is=6a5cf07f&hm=f5e3e0ec4b9a713af4bc775ddd0e8fe8c6a3a57e57a1d8b59ba0411643e31835';

function getTrackIdentifier(track) {
    return track?.info?.identifier || track?.info?.uri || track?.info?.title;
}

// Moves the most-recently-added queue item to the given index, using only
// queue methods already proven to work elsewhere (add/remove/splice).
function moveLastAddedTo(player, index) {
    const lastIndex = player.queue.length - 1;
    const item = player.queue[lastIndex];
    player.queue.remove(lastIndex);
    player.queue.splice(index, 0, item);
    return item;
}

// If the currently playing track belongs to the protected user, this blocks
// the skip: it interrupts playback with a warning clip (rate-limited to once
// every 60s), then re-queues the SAME track immediately after so it resumes
// from the exact position it was interrupted at. Returns true if it intercepted.
async function maybePlaySedseWarning(client, player) {
    const requesterId = player.current?.info?.requester?.id;
    if (requesterId !== SEDSE_USER_ID || !player.current) {
        return false;
    }

    const originalTrack = player.current;
    const originalPosition = player.position || 0;
    const guildData = getGuildMusicData(player.guildId);

    let warningQueued = false;

    if (canPlaySedseWarning(player.guildId)) {
        try {
            const result = await client.riffy.resolve({
                query: SEDSE_WARNING_AUDIO_URL,
                requester: { id: client.user.id, username: client.user.username },
            });

            const warningTrack = result?.tracks?.[0];
            if (warningTrack) {
                player.queue.add(warningTrack);
                moveLastAddedTo(player, 0);
                markSedseWarningPlayed(player.guildId);
                warningQueued = true;
            } else {
                logger.warn('Sedse warning: no track resolved from audio URL', { loadType: result?.loadType });
            }
        } catch (error) {
            logger.error('Sedse warning: failed to resolve/queue warning track:', error);
        }
    }

    // Re-queue the same track so it plays right after the warning (or
    // immediately, if the warning is on cooldown and was skipped this time).
    player.queue.add(originalTrack);
    const resumeTrack = moveLastAddedTo(player, warningQueued ? 1 : 0);

    const resumeIdentifier = getTrackIdentifier(resumeTrack);
    setPendingResume(player.guildId, resumeIdentifier, originalPosition);

    // Clear the trackStart de-dupe guard so this legitimate re-start of the
    // same track isn't mistaken for a duplicate event and ignored.
    guildData.lastStartedTrack = null;

    return true;
}

export async function playSedseWarningIfApplicable(client, player) {
    return maybePlaySedseWarning(client, player);
}

export function getPlayer(client, guildId) {
    return client.riffy?.players?.get(guildId) || null;
}

export function assertRiffyAvailable(client) {
    if (!client.riffy) {
        throw new TitanBotError(
            'Lavalink not configured',
            ErrorTypes.CONFIGURATION,
            'Music is unavailable — Lavalink is not configured.',
        );
    }
}

export function assertInVoice(member) {
    if (!requireVoiceChannel(member)) {
        throw new TitanBotError(
            'Not in voice channel',
            ErrorTypes.USER_INPUT,
            'You need to be in a voice channel.',
        );
    }
}

export function assertCanControl(member, player) {
    const memberChannel = member?.voice?.channel;
    if (!memberChannel || memberChannel.id !== player?.voiceChannel) {
        throw new TitanBotError(
            'Wrong voice channel',
            ErrorTypes.PERMISSION,
            VOICE_CHANNEL_DENIAL,
        );
    }
}

export async function ensurePlayer(client, interaction) {
    assertRiffyAvailable(client);
    assertInVoice(interaction.member);

    const guildId = interaction.guild.id;
    const guildData = getGuildMusicData(guildId);
    let player = getPlayer(client, guildId);

    if (!player) {
        player = client.riffy.createConnection({
            guildId,
            voiceChannel: interaction.member.voice.channel.id,
            textChannel: interaction.channel.id,
            deaf: true,
        });
        guildData.playerChannelId = interaction.channel.id;
    }

    player.setVolume(guildData.volume);
    return { player, guildData };
}

function isDuplicateTrack(player, track) {
    const uri = track?.info?.uri;
    if (!uri) {
        return false;
    }
    // Only treat the current track as a genuine duplicate if something is actually
    // playing/paused. After a skip with an empty queue, Riffy can leave player.current
    // pointing at the old track even though nothing is really active anymore.
    const somethingActive = player.playing || player.paused;
    if (somethingActive && player.current?.info?.uri === uri) {
        return true;
    }
    return player.queue.some((existing) => existing.info?.uri === uri);
}

export async function joinVoiceChannel(client, interaction) {
    assertRiffyAvailable(client);
    assertInVoice(interaction.member);

    const guildId = interaction.guild.id;
    const guildData = getGuildMusicData(guildId);
    const channel = interaction.member.voice.channel;
    let player = getPlayer(client, guildId);

    if (player && player.voiceChannel !== channel.id) {
        try {
            player.destroy();
        } catch {
            // player may already be gone
        }
        player = null;
    }

    if (!player) {
        player = client.riffy.createConnection({
            guildId,
            voiceChannel: channel.id,
            textChannel: interaction.channel.id,
            deaf: true,
        });
        guildData.playerChannelId = interaction.channel.id;
    }

    player.setVolume(guildData.volume);

    return successEmbed(
        'Joined Voice Channel',
        `Connected to **${channel.name}**. Use /play to start music, or /music for playback controls.`,
    );
}

export async function playQuery(client, interaction, query) {
    if (YOUTUBE_URL_PATTERN.test(query)) {
        throw new TitanBotError(
            'YouTube URL blocked',
            ErrorTypes.USER_INPUT,
            'YouTube links are not supported. Try a song name instead.',
        );
    }

    const { player, guildData } = await ensurePlayer(client, interaction);

    const result = await client.riffy.resolve({
        query,
        requester: interaction.user,
    });

    const { loadType, tracks, playlistInfo } = result;

    if (loadType === 'playlist' || loadType === 'PLAYLIST_LOADED') {
        let added = 0;
        let skipped = 0;

        for (const track of tracks) {
            track.info.requester = interaction.user;
            if (isDuplicateTrack(player, track)) {
                skipped += 1;
                continue;
            }
            player.queue.add(track);
            added += 1;
        }

        if (!player.playing && !player.paused) {
            player.play();
        }

        return {
            embed: successEmbed(
                'Playlist Added',
                `**${playlistInfo?.name || 'Playlist'}**\nAdded ${added} of ${tracks.length} track(s).${skipped ? ` Skipped ${skipped} duplicate(s).` : ''}`,
            ),
        };
    }

    if (
        loadType === 'search'
        || loadType === 'track'
        || loadType === 'SEARCH_RESULT'
        || loadType === 'TRACK_LOADED'
    ) {
        const track = tracks?.[0];
        if (!track) {
            throw new TitanBotError('No results', ErrorTypes.USER_INPUT, 'No results found for that query.');
        }

        if (isDuplicateTrack(player, track)) {
            throw new TitanBotError(
                'Duplicate track',
                ErrorTypes.USER_INPUT,
                `**${track.info.title}** is already in the queue or playing.`,
            );
        }

        track.info.requester = interaction.user;

        const willPlayNow = !player.playing && !player.paused;
        player.queue.add(track);
        const queuePosition = player.queue.length;

        if (willPlayNow) {
            player.play();
        }

        return {
            embed: successEmbed(
                willPlayNow ? 'Now Playing' : 'Track Added',
                willPlayNow
                    ? `**${track.info.title}**\n${track.info.author}`
                    : `**${track.info.title}**\n${track.info.author}\nPosition: #${queuePosition} in queue`,
            ),
        };
    }

    throw new TitanBotError('No results', ErrorTypes.USER_INPUT, `No results found. (loadType: ${loadType})`);
}

export async function skipTrack(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, 'Nothing is playing right now.');
    }
    assertCanControl(interaction.member, player);
    const title = player.current.info?.title || 'Unknown';

    const intercepted = await maybePlaySedseWarning(client, player);

    // Under track-loop, stop() would replay the same track. Clear it so the skip
    // advances; trackStart re-applies the stored loop mode to the next track.
    if (player.loop === 'track') {
        player.setLoop('none');
    }
    player.stop();

    if (intercepted) {
        return successEmbed('Nice Try', `**${title}** can't be skipped. It'll resume right where it left off.`);
    }

    return successEmbed('Skipped', `Skipped **${title}**.`);
}

export async function stopPlayback(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, 'No active music player.');
    }
    assertCanControl(interaction.member, player);

    const guildData = getGuildMusicData(interaction.guild.id);
    const queueLength = player.queue?.length || 0;

    if (queueLength >= 5 && guildData.stopConfirmPending !== interaction.user.id) {
        guildData.stopConfirmPending = interaction.user.id;
        setTimeout(() => {
            if (guildData.stopConfirmPending === interaction.user.id) {
                guildData.stopConfirmPending = null;
            }
        }, 15000);
        return successEmbed(
            'Confirm Stop',
            `There are **${queueLength}** tracks in the queue. Run **/music stop** again within 15 seconds to confirm.`,
        );
    }

    guildData.stopConfirmPending = null;
    await destroyPlayerSession(client, interaction.guild.id, player, guildData);
    return successEmbed('Stopped', 'Playback stopped and the queue was cleared.');
}

export async function applyPause(client, guildId) {
    const player = getPlayer(client, guildId);
    if (!player?.current || player.paused) {
        return false;
    }

    player.pause(true);
    await refreshPlayerMessage(client, guildId);
    return true;
}

export async function applyResume(client, guildId) {
    const player = getPlayer(client, guildId);
    if (!player?.current || !player.paused) {
        return false;
    }

    player.pause(false);
    await refreshPlayerMessage(client, guildId);
    return true;
}

export async function pausePlayback(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, 'Nothing is playing right now.');
    }
    assertCanControl(interaction.member, player);

    if (player.paused) {
        throw new TitanBotError('Already paused', ErrorTypes.USER_INPUT, 'Playback is already paused.');
    }

    await applyPause(client, interaction.guild.id);
    return successEmbed('Paused', 'Playback paused.');
}

export async function resumePlayback(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, 'Nothing is playing right now.');
    }
    assertCanControl(interaction.member, player);

    if (!player.paused) {
        throw new TitanBotError('Not paused', ErrorTypes.USER_INPUT, 'Playback is not paused.');
    }

    await applyResume(client, interaction.guild.id);
    return successEmbed('Resumed', 'Playback resumed.');
}

export async function shuffleQueue(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Empty queue', ErrorTypes.USER_INPUT, 'The queue is empty.');
    }
    assertCanControl(interaction.member, player);
    player.queue.shuffle();
    getGuildMusicData(interaction.guild.id).shuffle = true;
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Shuffled', 'The queue has been shuffled.');
}

export async function setLoopMode(client, interaction, mode) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, 'No active music player.');
    }
    assertCanControl(interaction.member, player);

    const guildData = getGuildMusicData(interaction.guild.id);
    guildData.loop = mode;
    player.setLoop(mode);

    const labels = { none: 'Off', track: 'Track', queue: 'Queue' };
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Loop Updated', `Loop mode set to **${labels[mode] || mode}**.`);
}

export async function toggleLoop(client, interaction) {
    const guildData = getGuildMusicData(interaction.guild.id);
    const next = guildData.loop === 'none' ? 'track' : guildData.loop === 'track' ? 'queue' : 'none';
    return setLoopMode(client, interaction, next);
}

export async function setVolume(client, interaction, volume) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, 'No active music player.');
    }
    assertCanControl(interaction.member, player);

    const guildData = getGuildMusicData(interaction.guild.id);
    guildData.volume = Math.max(0, Math.min(100, volume));
    player.setVolume(guildData.volume);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Volume Updated', `Volume set to **${guildData.volume}%**.`);
}

export async function adjustVolume(client, interaction, delta) {
    const guildData = getGuildMusicData(interaction.guild.id);
    return setVolume(client, interaction, guildData.volume + delta);
}

export async function seekTrack(client, interaction, seconds) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, 'Nothing is playing right now.');
    }
    assertCanControl(interaction.member, player);

    const info = player.current.info || {};
    if (info.isStream || info.isSeekable === false) {
        throw new TitanBotError(
            'Not seekable',
            ErrorTypes.USER_INPUT,
            'This track cannot be seeked (it may be a live stream).',
        );
    }

    const position = Math.max(0, seconds * 1000);
    if (info.length && position > info.length) {
        throw new TitanBotError(
            'Seek out of range',
            ErrorTypes.USER_INPUT,
            `You can only seek up to ${Math.floor(info.length / 1000)}s for this track.`,
        );
    }

    player.seek(position);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Seeked', `Seeked to **${seconds}s**.`);
}

export async function removeFromQueue(client, interaction, index) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Empty queue', ErrorTypes.USER_INPUT, 'The queue is empty.');
    }
    assertCanControl(interaction.member, player);

    const queueIndex = index - 1;
    if (queueIndex < 0 || queueIndex >= player.queue.length) {
        throw new TitanBotError('Invalid index', ErrorTypes.USER_INPUT, `Invalid queue position. Queue has ${player.queue.length} track(s).`);
    }

    const removed = player.queue[queueIndex];
    player.queue.remove(queueIndex);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Removed', `Removed **${removed.info?.title || 'track'}** from the queue.`);
}

export async function moveInQueue(client, interaction, from, to) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Empty queue', ErrorTypes.USER_INPUT, 'The queue is empty.');
    }
    assertCanControl(interaction.member, player);

    const fromIndex = from - 1;
    const toIndex = to - 1;
    if (fromIndex < 0 || fromIndex >= player.queue.length || toIndex < 0 || toIndex >= player.queue.length) {
        throw new TitanBotError('Invalid index', ErrorTypes.USER_INPUT, 'Invalid queue positions.');
    }

    const track = player.queue[fromIndex];
    player.queue.remove(fromIndex);
    player.queue.splice(toIndex, 0, track);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Moved', `Moved **${track.info?.title || 'track'}** to position #${to}.`);
}

export async function clearQueue(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Empty queue', ErrorTypes.USER_INPUT, 'The queue is already empty.');
    }
    assertCanControl(interaction.member, player);
    player.queue.clear();
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed('Queue Cleared', 'All queued tracks were removed.');
}

export async function setTwentyFourSeven(client, interaction, enabled) {
    const guildData = getGuildMusicData(interaction.guild.id);
    guildData.twentyFourSeven = enabled;
    return successEmbed(
        '24/7 Mode',
        enabled
            ? '24/7 mode enabled. The bot will stay in the voice channel when the queue ends.'
            : '24/7 mode disabled. The bot will leave after 30 seconds of idle time.',
    );
}

export function buildNowPlayingReply(client, guildId) {
    const player = getPlayer(client, guildId);
    if (!player?.current) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, 'Nothing is playing right now.');
    }
    const guildData = getGuildMusicData(guildId);
    return {
        embeds: [buildNowPlayingEmbed(player.current, player, guildData)],
    };
}

export function buildQueueReply(client, guildId, page = 0) {
    const player = getPlayer(client, guildId);
    if (!player) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, 'No active music player.');
    }

    const totalPages = Math.max(1, Math.ceil((player.queue?.length || 0) / getQueuePageSize()));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);

    return {
        embeds: [buildQueueEmbed(player.queue, player.current, safePage)],
        components: totalPages > 1 ? [buildQueuePaginationRow(safePage, totalPages)] : [],
        page: safePage,
        totalPages,
    };
}

export async function destroyPlayerSession(client, guildId, player, guildData, { forceDisconnect = false } = {}) {
    clearUpdateInterval(guildData);
    if (guildData.idleTimeout) {
        clearTimeout(guildData.idleTimeout);
        guildData.idleTimeout = null;
    }

    guildData.previousTracks = [];
    guildData.stopConfirmPending = null;
    guildData.autoPaused = false;
    guildData.queuePages?.clear();

    if (guildData.playerMessageId && guildData.playerChannelId) {
        try {
            const channel = client.channels.cache.get(guildData.playerChannelId);
            if (channel) {
                const msg = await channel.messages.fetch(guildData.playerMessageId);
                await msg.delete();
            }
        } catch (error) {
            logger.warn(`Failed to delete music panel on session destroy: ${error.message}`);
        }
    }

    guildData.playerMessageId = null;
    guildData.playerChannelId = null;

    if (player) {
        player.queue.clear();
        player.stop();
        if (forceDisconnect || !guildData.twentyFourSeven) {
            player.destroy();
        }
    }
}

export async function leaveVoiceChannel(client, interaction) {
    assertRiffyAvailable(client);

    const guildId = interaction.guild.id;
    const player = getPlayer(client, guildId);
    if (!player) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, 'I am not in a voice channel.');
    }
    assertCanControl(interaction.member, player);

    const channel = interaction.guild.channels.cache.get(player.voiceChannel);
    const channelName = channel?.name || 'voice channel';
    const guildData = getGuildMusicData(guildId);

    await destroyPlayerSession(client, guildId, player, guildData, { forceDisconnect: true });

    return successEmbed('Left Voice Channel', `Disconnected from **${channelName}**.`);
}

export async function replyMusicSuccess(interaction, embed) {
    if (interaction.deferred || interaction.replied) {
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } else {
        await interaction.reply({ embeds: [embed] });
    }
}
