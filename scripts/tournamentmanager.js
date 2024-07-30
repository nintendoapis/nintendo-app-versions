import { createHash } from 'node:crypto';
import * as vm from 'node:vm';
import { load } from 'cheerio';
import beautify from 'js-beautify';

const html_url = new URL('https://c.nintendo.com/splatoon3-tournament/?lang=en-GB');

const html_response = await fetch(html_url);
const html_body = (await html_response.text())
    .replace(/("_sentryTraceData": *")[^"]*(")/, '$1$2')
    .replace(/(sentry-trace_id=)[0-9a-f]{32}/, '$1');

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

const graphql_queries = [];
let downloaded_assets = [];

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

    await extractRelayGraphqlRequestModulesFromJs(url.pathname, url, formatted_js);
}

async function extractRelayGraphqlRequestModulesFromJs(name, url, formatted_js) {
    if (downloaded_assets.includes(url.pathname)) return;
    downloaded_assets.push(url.pathname);

    for (const match of formatted_js.matchAll(/\bid: "([0-9a-f]{64})"/gi)) {
        console.warn('Found GraphQL query module', url.pathname, match.index, match[1]);

        const end_index = formatted_js.indexOf('\n        },', match.index) + 1;
        const end_line_index = formatted_js.lastIndexOf('\n', end_index) + 1;
        const end_line = formatted_js.substr(end_line_index, formatted_js.indexOf('\n', end_index) - end_line_index);
        const indent = end_line.match(/^\s*/)[0];

        let start_index = end_line_index;
        let start_line = end_line;
        do {
            start_index = formatted_js.lastIndexOf('\n', start_index - 1);
            const start_line_index = formatted_js.lastIndexOf('\n', start_index - 1) + 1;
            start_line = formatted_js.substr(start_line_index,
                formatted_js.indexOf('\n', start_index) - start_line_index);
        } while (start_line.startsWith(indent + ' '));

        const module_call_js =
            'let exports = {}; (' + start_line.replace(/\b\d+:/, '') +
            formatted_js.substr(start_index, end_line_index - start_index) +
            '})(null, exports, {r: () => undefined, d: (n, e) => Object.assign(exports, e)}); exports.default';
        const query = vm.runInNewContext(module_call_js, {}, {
            timeout: 1000,
        });

        const data = {start_index, start_line, end_index, end_line, indent};
        const module_js = '//' + start_line +
            formatted_js.substr(start_index, end_line_index - start_index) +
            '//' + end_line;

        if (typeof query === 'function' && query.toString().replaceAll(/\n/g, '').match(/^\s*function(\s+[0-9A-Za-z_]+)?\s*\(\)\s*\{\s*return\s+[0-9A-Za-z_]+\s*;?\s*}\s*$/)) {
            const result = query.call(null);

            if (result?.metadata?.refetch?.operation) {
                console.warn('GraphQL query module is refetch operation', url.pathname, match.index, match[1]);

                const query = result.metadata.refetch.operation;
                graphql_queries.push({...data, query, data: query.params});

                continue;
            }
        }

        if (!query?.params) {
            console.warn('GraphQL query module has no query, skipping', url.pathname, match.index, match[1], query.toString());
            continue;
        }

        graphql_queries.push({...data, query, data: query.params});
    }
}

if (!build_manifest || !sentry_release) {
    throw new Error('Unable to find build manifest or Sentry release data');
}

for (const route of Object.keys(build_manifest)) {
    if (!route.startsWith('/')) continue;

    for (const asset_url of build_manifest[route]) {
        if (!asset_url.endsWith('.js')) continue;

        const url = new URL('_next/' + asset_url, html_url);

        console.warn('Downloading asset', url.href);

        const response = await fetch(url);
        const js = await response.text();

        const formatted_js = beautify(js);

        await extractRelayGraphqlRequestModulesFromJs(asset_url, url, formatted_js);
    }
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

    graphql_queries: Object.fromEntries(graphql_queries.map(d => [d.data.name, d.data.id])),
};

console.log(JSON.stringify(result, null, 4));
