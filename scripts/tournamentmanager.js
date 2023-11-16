import { createHash } from 'node:crypto';
import * as vm from 'node:vm';
import { load } from 'cheerio';
import beautify from 'js-beautify';

const html_url = new URL('https://c.nintendo.com/splatoon3-tournament/?lang=en-GB');

const html_response = await fetch(html_url);
const html_body = await html_response.text();

const html_sha256 = createHash('sha256').update(html_body).digest('hex');

const $ = load(html_body);

const script_urls = [];

let next_data = null;

for (const script of $('script')) {
    const id = $(script).attr('id');

    if (id === '__NEXT_DATA__') {
        next_data = JSON.parse($(script).text());
        continue;
    }

    const src = $(script).attr('src');
    if (!src) continue;

    const url = new URL(src, html_url);
    if (url.origin !== html_url.origin) continue;

    script_urls.push(url);
}

console.warn('Found scripts', script_urls.map(s => s.pathname.substr(1)));

let build_manifest_url = null;
let build_manifest_headers = null;
let build_manifest_hash_sha256 = null;
let build_manifest = null;

let app_url = null;
let sentry_release = null;

for (const script_url of script_urls) {
    const url = new URL(script_url, html_url);

    console.warn('Downloading asset', url.href);

    const response = await fetch(url);
    const data = new Uint8Array(await response.arrayBuffer());

    const js = new TextDecoder().decode(data);
    const formatted_js = beautify(js);

    if (js.startsWith('self.__BUILD_MANIFEST=')) {
        console.warn('Found build manifest at %s', script_url);

        build_manifest_url = script_url;
        build_manifest_headers = {
            'last-modified': response.headers.get('last-modified'),
            'etag': response.headers.get('etag'),
        };
        build_manifest_hash_sha256 = createHash('sha256').update(data).digest('hex');

        const context = vm.createContext({});
        context.self = context;

        vm.runInContext(js, context, {
            timeout: 1000,
        });

        if (!context.__BUILD_MANIFEST) {
            throw new Error('Build manifest not set');
        }

        build_manifest = context.__BUILD_MANIFEST;
    }

    for (const sentry_release_match of formatted_js.matchAll(/\.SENTRY_RELEASE = {\n( *)/g)) {
        const sentry_release_start = sentry_release_match[0] + formatted_js.substr(sentry_release_match.index + sentry_release_match[0].length);
        const lines = sentry_release_start.split('\n');
        lines.shift();
        const end_index = lines.findIndex(l => !l.startsWith(sentry_release_match[1]));

        if (lines[end_index].trimStart().startsWith('}')) {
            const sentry_release_str = '{\n' + lines.slice(0, end_index).join('\n') + '\n}';

            sentry_release = vm.runInNewContext('(' + sentry_release_str + ')', {}, {
                filename: script_url.toString(),
                timeout: 1000,
            });

            console.warn('Found sentry release data', sentry_release);
        } else {
            console.warn('Failed to find end of sentry release', sentry_release_match.index, sentry_release_match, lines);
        }
    }

    if (build_manifest && sentry_release) break;
}

const result = {
    revision: sentry_release?.id,
    build_id: next_data?.buildId,

    html_url: html_url.toString(),
    html_sha256,

    build_manifest_url,
    build_manifest_headers,
    build_manifest_hash_sha256,
    build_manifest,

    app_url,
    sentry_release,
};

console.log(JSON.stringify(result, null, 4));
