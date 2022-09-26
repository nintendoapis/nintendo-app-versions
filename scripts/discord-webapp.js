import * as fs from 'node:fs/promises';
import fetch from 'node-fetch';

/** @type {'splatnet3'} */
const app = process.argv[2];
const app_name = app === 'splatnet3' ? 'SplatNet 3' : app;
const app_colour = app === 'splatnet3' ? 0xfefb55 : null;

const web = JSON.parse(await fs.readFile(new URL('../data/' + app + '-app.json', import.meta.url), 'utf-8'));

const known = await (async () => {
    try {
        return JSON.parse(await fs.readFile(new URL('../data/' + app + '-known.json', import.meta.url), 'utf-8'));
    } catch (err) {
        return {versions: []};
    }
})();
const new_versions = [];

if (!known.versions.includes(web.version + '-' + web.revision + '-web')) {
    const other_revisions = known.versions.filter(v => v.startsWith(web.version + '-') && v.endsWith('-web'));
    console.log('New version detected', web.version, web.revision, other_revisions);
    known.versions.push(web.version + '-' + web.revision + '-web');
    new_versions.push([web.version, web.revision, 'Web', 'Web', other_revisions]);
}

console.log('New versions', new_versions.length);

if (new_versions.length && process.env.DISCORD_WEBHOOK_ID) {
    for (const [version, revision, platform, source, other_revisions] of new_versions) {
        const embed = {
            title: 'New ' + app_name + ' ' + (other_revisions.length ? 'revision' : 'version') + ' detected',
            color: app_colour,
            author: {
                name: 'nintendo-app-versions',
                url: 'https://github.com/samuelthomas2774/nintendo-app-versions',
            },
            fields: [
                { name: 'Version', value: version, inline: true },
                { name: 'Platform', value: platform, inline: true },
                { name: 'Source', value: source, inline: true },
                { name: 'Revision', value: '`' + revision + '`', inline: true },
            ],
        };

        const mention = process.env.DISCORD_WEBHOOK_MENTION ? '<@' + process.env.DISCORD_WEBHOOK_MENTION + '> ' : '';
        const message = {
            content: mention + app_name + ' v' + version + '-' + revision.substr(0, 8) + ' released',
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
