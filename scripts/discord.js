import * as fs from 'node:fs/promises';
import fetch from 'node-fetch';

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
    new_versions.push([itunes.result.version, 'iOS', 'iTunes']);
}
if (!known.versions.includes(googleplay.version + '-android')) {
    console.log('New version detected on Google Play', googleplay.version);
    known.versions.push(googleplay.version + '-android');
    new_versions.push([googleplay.version, 'Android', 'Google Play']);
}

for (const version of nintendo_jp.versions) {
    const platform_ios = version.label.includes('iOS');
    const platform_android = version.label.includes('Android');
    const platforms = !platform_ios && !platform_android ? ['ios', 'android'] :
        platform_ios ? ['ios'] : platform_android ? ['android'] : [];

    if (platforms.includes('ios') && !known.versions.includes(version.version + '-ios')) {
        console.log('New version detected on Nintendo JP', version.version);
        known.versions.push(version.version + '-ios');
        new_versions.push([version.version, 'iOS', 'Nintendo JP']);
    }
    if (platforms.includes('android') && !known.versions.includes(version.version + '-android')) {
        console.log('New version detected on Nintendo JP', version.version);
        known.versions.push(version.version + '-android');
        new_versions.push([version.version, 'Android', 'Nintendo JP']);
    }
}

console.log('New versions', new_versions);

if (new_versions.length && process.env.DISCORD_WEBHOOK_ID) {
    for (const [version, platform, source] of new_versions) {
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
                { name: 'Source', value: source, inline: true },
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

        console.log('Sent Discord notification', message, embed.fields, await response.json());
    }
}

await fs.writeFile(new URL('../data/' + app + '-known.json', import.meta.url), JSON.stringify(known, null, 4) + '\n', 'utf-8');
