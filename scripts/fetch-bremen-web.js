import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import beautify from 'js-beautify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataPath = join(__dirname, '..', 'data', 'bremen-app.json');

function formatLastModifiedDate(lastModified) {
    if (!lastModified) return null;

    const date = new Date(lastModified);
    if (Number.isNaN(date.getTime())) return null;

    return date.toISOString().slice(0, 10);
}

function extractAssignedObjectContaining(source, assignmentPrefix, anchorText) {
    const anchorIndex = source.indexOf(anchorText);
    if (anchorIndex < 0) return null;

    const assignmentIndex = source.lastIndexOf(assignmentPrefix, anchorIndex);
    if (assignmentIndex < 0) return null;

    const startIndex = source.indexOf('{', assignmentIndex);
    if (startIndex < 0) return null;

    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let index = startIndex; index < source.length; index++) {
        const char = source[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) return source.slice(startIndex, index + 1);
        }
    }
    return null;
}

function extractEndpointsFromJs(source) {
    const endpoints = new Set();
    const endpointRegex = /path:\s*["'](\/[^"'\n]*)["']/g;
    for (const match of source.matchAll(endpointRegex)) endpoints.add(match[1]);
    return Array.from(endpoints).sort();
}

const html_url = new URL('https://music.nintendo.com/en-US/');
const html_response = await fetch(html_url);
const html_body = await html_response.text();

const $ = load(html_body);
const script_urls = [];
for (const script of $('script')) {
    const src = $(script).attr('src');
    if (!src) continue;
    const url = new URL(src, html_url);
    if (url.origin !== html_url.origin) continue;
    script_urls.push(url.toString());
}

console.warn('Found scripts', script_urls);
if (!script_urls.length) throw new Error('Could not find JavaScript source');

let app_env = null;
let app_env_script_url = null;
let app_env_script_sha256 = null;
let app_env_script_headers = null;
const endpointsSet = new Set();
const scripts = [];

for (const src of script_urls) {
    const response = await fetch(src);
    const body = await response.text();
    const headers = {
        'last-modified': response.headers.get('last-modified'),
    };
    const script_sha256 = createHash('sha256').update(body).digest('hex');

    scripts.push({
        url: src,
        sha256: script_sha256,
        headers,
    });

    if (src.includes('/main-app-')) {
        const formatted = beautify(body);
        const app_env_source = extractAssignedObjectContaining(
            formatted,
            'let d = ',
            'host: _.env.PUBLIC_HOST || "https://music.nintendo.com"'
        );
        if (app_env_source) {
            app_env = vm.runInNewContext(`(${app_env_source})`, { _: { env: {} } }, { filename: src, timeout: 1000 });
            app_env_script_url = src;
            app_env_script_sha256 = script_sha256;
            app_env_script_headers = headers;
            console.warn('Found app environment at', src);
        }
    }

    // collect endpoints from JS bodies
    for (const e of extractEndpointsFromJs(body)) endpointsSet.add(e);
}

const result = {
    html_url: html_url.toString(),
    html_sha256: createHash('sha256').update(html_body).digest('hex'),
    script_urls,
    script_headers: scripts,
    endpoints: Array.from(endpointsSet).sort(),
    app_env,
    app_env_script_url,
    app_env_script_sha256,
    app_env_script_headers,
    revision: app_env_script_sha256 && app_env_script_headers?.['last-modified'] ? `${app_env_script_sha256.slice(0,8)}-${formatLastModifiedDate(app_env_script_headers['last-modified'])}` : null,
};

writeFileSync(dataPath, JSON.stringify(result, null, 4));
console.log(JSON.stringify(result, null, 4));