import * as fs from 'node:fs/promises';
import fetch from 'node-fetch';

/** @type {'splatnet3'|'nooklink'} */
const app = process.argv[2];
const app_info = {
    'splatnet3': ['SplatNet 3', 0xfefb55, 'https://s.nintendo.com/av5ja-lp1/znca/game/4834290508791808'],
    'nooklink': ['NookLink', 0x6cc1fe, 'https://dpl.sd.lp1.acbaa.srv.nintendo.net/znca/game/4953919198265344'],
};
const app_name = app_info[app]?.[0] ?? null;
const app_colour = app_info[app]?.[1] ?? null;
const app_url = app_info[app]?.[2] ?? null;

const web = JSON.parse(await fs.readFile(new URL('../data/' + app + '-app.json', import.meta.url), 'utf-8'));
const revision = 'revision' in web ? web.version + '-' + web.revision : web.version;

const known = await (async () => {
    try {
        return JSON.parse(await fs.readFile(new URL('../data/' + app + '-known.json', import.meta.url), 'utf-8'));
    } catch (err) {
        return {versions: []};
    }
})();
const new_versions = [];

if (!known.versions.includes(revision + '-web')) {
    const other_revisions = known.versions.filter(v => v.startsWith(web.version + '-') && v.endsWith('-web'));
    console.log('New version detected', web.version, web.revision, other_revisions);
    known.versions.push(revision + '-web');
    new_versions.push([web.version, web.revision ?? null, 'Web', 'Web', other_revisions]);
}

console.log('New versions', new_versions.length);

const app_env_json = JSON.stringify(web.app_env);
const known_app_env_json = JSON.stringify(known.app_env);

for (const [version, revision, platform, source, other_revisions] of new_versions) {
    if (process.env.DISCORD_WEBHOOK_ID) {
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
                ...(revision ? [
                    { name: 'Revision', value: '`' + revision + '`', inline: true },
                ] : []),
                ...(app_env_json !== known_app_env_json ? [
                    {
                        name: 'Environment variables',
                        value: '```json\n' + JSON.stringify(web.app_env, null, 4) + '\n```',
                        inline: false,
                    },
                ] : []),
            ],
        };

        const mention = process.env.DISCORD_WEBHOOK_MENTION ? '<@' + process.env.DISCORD_WEBHOOK_MENTION + '> ' : '';
        const message = {
            content: mention + app_name + ' v' + version + (revision ? '-' + revision.substr(0, 8) : '') + ' released',
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

    if (process.env.MASTODON_TOKEN) {
        const status = app_name + ' v' + version + (revision ? '-' + revision.substr(0, 8) : '') + ' released' +
            (app_url ? '\n\n' + app_url : '');

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
                'Idempotency-Key': version + '-' + platform + '-' + revision,
            },
            body: JSON.stringify(data),
        });

        console.log('Posted Mastodon status', data, await response.json());
    }
}

await fs.writeFile(new URL('../data/' + app + '-known.json', import.meta.url), JSON.stringify(known, null, 4) + '\n', 'utf-8');
