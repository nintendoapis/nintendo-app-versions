import { createHash } from 'node:crypto';
import * as vm from 'node:vm';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import beautify from 'js-beautify';

const html_url = new URL('https://api.lp1.av5ja.srv.nintendo.net');

const html_response = await fetch(html_url);
const html_body = await html_response.text();

const $ = load(html_body);

const script_urls = [];

for (const script of $('script')) {
    const src = $(script).attr('src');
    if (!src) continue;

    const url = new URL(src, html_url);
    if (url.origin !== html_url.origin) continue;

    script_urls.push(url);
}

console.warn('Found scripts', script_urls.map(u => u.href));

if (!script_urls.length) {
    throw new Error('Could not find JavaScript source');
}

const version_regex = /\b([0-9a-f]{40})\b.*revision_info_not_set.*\n?.*\b(\d+\.\d+\.\d+)\b-/;
let script_url;
let script_sha256;
let match = null;
let env_match = null;
let app_env = null;

for (const url of script_urls) {
    const response = await fetch(url);
    const body = await response.text();

    const formatted_js = beautify(body);

    match = formatted_js.match(version_regex);
    if (!match) continue;

    script_url = url;
    script_sha256 = createHash('sha256').update(body).digest('hex');

    env_match = formatted_js.match(/{\n( *)NODE_ENV: /);

    if (env_match) {
        const env_start = env_match[0] + formatted_js.substr(env_match.index + env_match[0].length);
        const env = env_start.split('\n');
        const start = env.shift();
        const end_index = env.findIndex(l => !l.startsWith(env_match[1]));

        if (env[end_index].trimStart().startsWith('}')) {
            const env_str = start + '\n' + env.slice(0, end_index).join('\n') + '\n}';

            app_env = vm.runInNewContext('(' + env_str + ')', {}, {
                filename: script_url.toString(),
                timeout: 1000,
            });
        } else {
            console.warn('Failed to find end of app environment', env_match.index);
        }
    } else {
        console.warn('Could not find app environment in main chunk JavaScript source');
    }

    break;
}

if (!match) {
    throw new Error('Could not find version in any JavaScript source code');
}

const version = match[2];
const revision = match[1];

console.warn(
    'Found version match at %d',
    match.index,
    JSON.stringify(version),
    JSON.stringify(revision)
);
if (app_env) console.warn('Found app environment at %d', env_match.index, app_env);

const result = {
    web_app_ver: version + '-' + revision.substr(0, 8),

    version,
    revision,
    app_env,

    html_url: html_url.toString(),
    html_sha256: createHash('sha256').update(html_body).digest('hex'),

    script_url: script_url.toString(),
    script_sha256,
};

console.log(JSON.stringify(result, null, 4));
