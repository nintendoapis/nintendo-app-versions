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
let script_response;
let script_url;
let script_sha256;
let match = null;
let env_match = null;
let app_env = null;
const graphql_queries = [];

for (const url of script_urls) {
    const response = await fetch(url);
    const body = await response.text();

    const formatted_js = beautify(body);

    match = formatted_js.match(version_regex);
    if (!match) continue;

    script_response = response;
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

    const js_url = new URL(script_url);

    for (const match of formatted_js.matchAll(/\bid: "([0-9a-f]{64})"/gi)) {
        console.warn('Found GraphQL query module', js_url.pathname, match.index, match[1]);

        const end_index = formatted_js.indexOf('\n            },', match.index) + 1;
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
            '})(null, null, {r: () => undefined, d: (n, e) => Object.assign(exports, e)}); exports.default.call(null)';
        const query = vm.runInNewContext(module_call_js, {}, {
            timeout: 1000,
        });

        graphql_queries.push({query, data: {id: query.params.id, name: query.params.name}});
    }

    const chunk_json_modules = [];

    for (const match of formatted_js.matchAll(/\n {8}(const | {4})[0-9A-Za-z_]+ ?= ?(JSON\.parse\((['"])(.+)['"]\))(,|;)?/g)) {
        console.warn('Found JSON module', js_url.pathname, match.index, match[3]);

        const json = vm.runInNewContext(match[3] + match[4] + match[3], {}, {
            timeout: 1000,
        });

        const data = JSON.parse(json);
        chunk_json_modules.push(data);
    }

    for (const match of formatted_js.matchAll(/(\n( +)("(.+)"): )\{\n +kind: "Document",/ig)) {
        console.warn('Found GraphQL query entry', js_url.pathname, match.index, [...match[4].matchAll(/(query|mutation|fragment) +([a-z0-9-_]+)/ig)].map(m => m[0]).join(', '));

        const query = JSON.parse(match[3]);
        const start_index = match.index + match[1].length;
        const end = '\n' + match[2] + '}';
        const end_index = formatted_js.indexOf(end, start_index) + end.length;

        const query_js = formatted_js.substr(start_index, end_index - start_index);
        const parsed_query = vm.runInNewContext('(' + query_js + ')', {}, {
            timeout: 1000,
        });

        const operation = parsed_query.definitions.find(d => d.kind === 'OperationDefinition');
        if (!operation) continue;

        const persisted_query_id = chunk_json_modules.find(data => {
            if (!data || typeof data !== 'object') return false;
            if (!data[operation.name.value]) return false;

            for (const [key, value] of Object.entries(data)) {
                if (typeof value !== 'string') return false;
                if (!value.match(/^[0-9a-f]{64}$/)) return false;
            }

            return true;
        })?.[operation.name.value];
        if (!persisted_query_id) continue;

        graphql_queries.push({
            start_index, end_index, query, parsed_query,
            data: {
                id: persisted_query_id,
                name: operation.name.value,
                operation: operation.operation,
            },
        });
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
    html_headers: {
        'last-modified': html_response.headers.get('last-modified'),
        'etag': html_response.headers.get('etag'),
        'x-amz-version-id': html_response.headers.get('x-amz-version-id'),
    },

    script_url: script_url.toString(),
    script_sha256,
    script_headers: {
        'last-modified': script_response.headers.get('last-modified'),
        'etag': script_response.headers.get('etag'),
        'x-amz-version-id': script_response.headers.get('x-amz-version-id'),
    },

    graphql_queries: Object.fromEntries(graphql_queries.map(d => [d.data.name, d.data.id])),
};

console.log(JSON.stringify(result, null, 4));
