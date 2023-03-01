import * as fs from 'node:fs/promises';
import fetch from 'node-fetch';
import Turndown from 'turndown';

const turndown = new Turndown();

/** @type {'coral'|'moon'} */
const app = process.argv[2];
const app_name = app === 'moon' ? 'Nintendo Switch Parental Controls' : 'Nintendo Switch Online';

const itunes = JSON.parse(await fs.readFile(new URL('../data/' + app + '-itunes.json', import.meta.url), 'utf-8'));
const googleplay = JSON.parse(await fs.readFile(new URL('../data/' + app + '-google-play.json', import.meta.url), 'utf-8'));
// const nintendo_eu = JSON.parse(await fs.readFile(new URL('../data/' + app + '-nintendo-eu.json', import.meta.url), 'utf-8'));
const nintendo_jp = JSON.parse(await fs.readFile(new URL('../data/' + app + '-nintendo-jp.json', import.meta.url), 'utf-8'));

const known = await (async () => {
    try {
        return JSON.parse(await fs.readFile(new URL('../data/' + app + '-known.json', import.meta.url), 'utf-8'));
    } catch (err) {
        return {versions: []};
    }
})();
const new_versions = [];

if (!known.versions.includes(itunes.result.version + '-ios')) {
    console.log('New version detected on iTunes', itunes.result.version);
    known.versions.push(itunes.result.version + '-ios');
    new_versions.push([itunes.result.version, 'iOS', 'iTunes',
        itunes.result.trackViewUrl, itunes.result.releaseNotes]);
}
if (!known.versions.includes(googleplay.version + '-android')) {
    console.log('New version detected on Google Play', googleplay.version);
    known.versions.push(googleplay.version + '-android');
    new_versions.push([googleplay.version, 'Android', 'Google Play',
        googleplay.result.url, turndown.turndown(googleplay.result.recentChanges)]);
}

for (const version of nintendo_jp.versions) {
    const platform_ios = version.label.includes('iOS');
    const platform_android = version.label.includes('Android');
    const platforms = !platform_ios && !platform_android ? ['ios', 'android'] :
        platform_ios ? ['ios'] : platform_android ? ['android'] : [];

    if (platforms.includes('ios') && !known.versions.includes(version.version + '-ios')) {
        console.log('New version detected on Nintendo JP', version.version);
        known.versions.push(version.version + '-ios');
        new_versions.push([version.version, 'iOS', 'Nintendo JP',
            nintendo_jp.url, turndown.turndown(version.release_notes_html)]);
    }
    if (platforms.includes('android') && !known.versions.includes(version.version + '-android')) {
        console.log('New version detected on Nintendo JP', version.version);
        known.versions.push(version.version + '-android');
        new_versions.push([version.version, 'Android', 'Nintendo JP',
            nintendo_jp.url, turndown.turndown(version.release_notes_html)]);
    }
}

console.log('New versions', new_versions);

let discord_guild_id = null;

for (const [version, platform, source, url, release_notes] of new_versions) {
    let discord_message = null;
    let discord_message_url = null;
    let mastodon_status = null;

    if (process.env.DISCORD_WEBHOOK_ID) {
        if (!discord_guild_id && process.env.MASTODON_TOKEN) {
            const webhook_url = 'https://discord.com/api/webhooks/' + process.env.DISCORD_WEBHOOK_ID + '/' +
                process.env.DISCORD_WEBHOOK_TOKEN;

            const response = await fetch(webhook_url);
            const data = await response.json();

            discord_guild_id = data.guild_id;
        }

        const embed = {
            title: 'New ' + app_name + ' version detected',
            color: app === 'moon' ? 16673321 : 15073298,
            author: {
                name: 'nintendo-app-versions',
                url: 'https://github.com/samuelthomas2774/nintendo-app-versions',
            },
            fields: [
                { name: 'Version', value: version, inline: true },
                { name: 'Platform', value: platform, inline: true },
                { name: 'Source', value: `[${source}](${url})` , inline: true },
                { name: 'Release notes', value: release_notes },
            ],
        };

        const mention = process.env.DISCORD_WEBHOOK_MENTION ? '<@' + process.env.DISCORD_WEBHOOK_MENTION + '> ' : '';
        const message = {
            content: mention + app_name + ' v' + version + ' (' + platform + ') released',
            embeds: [embed],
        };

        const webhook_url = 'https://discord.com/api/webhooks/' + process.env.DISCORD_WEBHOOK_ID + '/' +
            process.env.DISCORD_WEBHOOK_TOKEN + '?wait=true';

        const response = await fetch(webhook_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });

        discord_message = await response.json();
        console.log('Sent Discord notification', message, embed.fields, discord_message);

        if (discord_guild_id) {
            discord_message_url = 'https://discord.com/channels/' + discord_guild_id +
                '/' + discord_message.channel_id + '/' + discord_message.id;
        }
    }

    if (process.env.MASTODON_TOKEN) {
        const status = app_name + ' v' + version + ' (' + platform + ') released\n\n' + url +
            (discord_message_url ? '\n' + discord_message_url : '') +
            '\n\n' + (release_notes && release_notes.split('\n').find(l => l && !l.startsWith('・') && !l.startsWith('-')) ?
                '> ' + release_notes.replace(/\n/g, '\n> ') : release_notes);

        const data = {
            status,
            // public, unlisted, private (followers), direct (mentions)
            visibility: 'public',
            language: 'en',
        };

        const response = await fetch('https://' + process.env.MASTODON_HOST + '/api/v1/statuses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + process.env.MASTODON_TOKEN,
                'Idempotency-Key': version + '-' + platform,
            },
            body: JSON.stringify(data),
        });

        mastodon_status = await response.json();
        console.log('Posted Mastodon status', data, mastodon_status);
    }
}

await fs.writeFile(new URL('../data/' + app + '-known.json', import.meta.url), JSON.stringify(known, null, 4) + '\n', 'utf-8');
