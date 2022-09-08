import { createHash } from 'node:crypto';
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

const version_regex = /\b(\d+\.\d+\.\d+)\b-.*\b([0-9a-f]{40})\b/;
let script_url;
let script_sha256;
let match = null;

for (const url of script_urls) {
    const response = await fetch(url);
    const body = await response.text();

    const formatted_js = beautify(body);

    match = formatted_js.match(version_regex);
    if (!match) continue;

    script_url = url;
    script_sha256 = createHash('sha256').update(body).digest('hex');

    break;
}

if (!match) {
    throw new Error('Could not find version in any JavaScript source code');
}

const version = match[1];
const revision = match[2];

console.warn(
    'Found version match at %d',
    match.index,
    JSON.stringify(version),
    JSON.stringify(revision)
);

const result = {
    version,
    revision,

    html_url: html_url.toString(),
    html_sha256: createHash('sha256').update(html_body).digest('hex'),

    script_url: script_url.toString(),
    script_sha256,
};

console.log(JSON.stringify(result, null, 4));
