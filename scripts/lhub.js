import { createHash } from 'node:crypto';
import * as vm from 'node:vm';
import { load } from 'cheerio';
import beautify from 'js-beautify';

const headers = {
    'User-Agent': 'Mozilla/5.0 (Nintendo Switch; NsoApplet) AppleWebKit/606.4 (KHTML, like Gecko) NF/6.0.1.15.4 NintendoBrowser/5.1.0.20389',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-GB,en;q=0.5',
    'Referer': 'https://lp1.nso.nintendo.net/',
    'DNT': '1',
    'Cookie': undefined,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
};

const html_url = new URL('https://lp1.nso.nintendo.net');

const html_response = await fetch(html_url, {
    headers,
});
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

let script_url;
let script_sha256;
let env_match = null;
let app_env = null;

for (const url of script_urls) {
    const response = await fetch(url, {
        headers,
    });
    const body = await response.text();

    const formatted_js = beautify(body);

    env_match = formatted_js.match(/{\n( *)NODE_ENV: /);
    if (!env_match) continue;

    script_url = url;
    script_sha256 = createHash('sha256').update(body).digest('hex');

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
        throw new Error('Failed to find end of app environment');
    }

    break;
}

if (!env_match) {
    throw new Error('Could not find app environment in any JavaScript source code');
}

console.warn('Found app environment at %d', env_match.index, app_env);

const result = {
    version: app_env.REACT_APP_VERSION,
    revision: app_env.REACT_APP_GIT_COMMIT_HASH,
    app_env,

    html_url: html_url.toString(),
    html_sha256: createHash('sha256').update(html_body).digest('hex'),

    script_url: script_url.toString(),
    script_sha256,
};

console.log(JSON.stringify(result, null, 4));
