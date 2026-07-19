import { MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
export function getMusicDeferOptions() {
    return {};
}
export async function deferMusicCommand(interaction) {
    return InteractionHelper.safeDefer(interaction, getMusicDeferOptions(interaction));
}
