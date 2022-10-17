import { createHash } from 'node:crypto';
import * as vm from 'node:vm';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import beautify from 'js-beautify';

const html_url = new URL('https://web.sd.lp1.acbaa.srv.nintendo.net');

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

const env_regex = /\bObject\((\{[^}]+\})\)/;
let script_url;
let script_sha256;
let match = null;

for (const url of script_urls) {
    const response = await fetch(url);
    const body = await response.text();

    const formatted_js = beautify(body);

    match = formatted_js.match(env_regex);
    if (!match) continue;

    script_url = url;
    script_sha256 = createHash('sha256').update(body).digest('hex');

    break;
}

if (!match) {
    throw new Error('Could not find app environment in any JavaScript source code');
}

const app_env = vm.runInNewContext('(' + match[1] + ')', {}, {
    filename: script_url.toString(),
    timeout: 1000,
});

const version = app_env.REACT_APP_VERSION;

console.warn(
    'Found app environment match at %d',
    match.index,
    JSON.stringify(version),
    app_env
);

const result = {
    version,
    app_env,

    html_url: html_url.toString(),
    html_sha256: createHash('sha256').update(html_body).digest('hex'),

    script_url: script_url.toString(),
    script_sha256,
};

console.log(JSON.stringify(result, null, 4));
