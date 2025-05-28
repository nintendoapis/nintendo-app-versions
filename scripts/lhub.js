import { createHash } from 'node:crypto';
import * as vm from 'node:vm';
import { load } from 'cheerio';
import beautify from 'js-beautify';

const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (Nintendo Switch; NsoApplet) AppleWebKit/606.4 (KHTML, like Gecko) NF/6.0.1.15.4 NintendoBrowser/5.1.0.20389',
    'Accept': '*/*',
    'Accept-Language': 'en-GB,en;q=0.5',
    'Referer': 'https://lp1.nso.nintendo.net/?country=GB&menu_page=home',
    'DNT': '1',
    'Cookie': undefined,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
});

const html_url = new URL('https://lp1.nso.nintendo.net/?country=GB&menu_page=home');

const html_response = await fetch(html_url, {
    headers,
});
const html_body = await html_response.text();

const $ = load(html_body);

const script_urls = [];

let next_data = null;

for (const script of $('script')) {
    const id = $(script).attr('id');

    if (id === '__NEXT_DATA__') {
        next_data = JSON.parse($(script).text());
        console.warn('Found Next.js data', next_data);
        continue;
    }

    const src = $(script).attr('src');
    if (!src) continue;

    const url = new URL(src, html_url);
    if (url.origin !== html_url.origin) continue;

    script_urls.push(url);
}

console.warn('Found scripts', script_urls.map(s => s.pathname.substr(1)));

if (!script_urls.length) {
    throw new Error('Could not find JavaScript source');
}

let app_env = null;

let build_manifest_url = null;
let build_manifest_headers = null;
let build_manifest_hash_sha256 = null;
let build_manifest = null;

function extractEnvFromJs(name, url, formatted_js) {
    const env_match = formatted_js.match(/{\n( *)CODE: /);

    if (env_match) {
        const env_start = env_match[0] + formatted_js.substr(env_match.index + env_match[0].length);
        const env = env_start.split('\n');
        const start = env.shift();
        const end_index = env.findIndex(l => !l.startsWith(env_match[1]));

        if (env[end_index].trimStart().startsWith('}')) {
            const env_str = start + '\n' + env.slice(0, end_index).join('\n') + '\n}';

            const context = {
                navigator: {userAgent: headers.get('User-Agent')},
            };

            // don't know what variable name the mock process object will get
            // after updates, so just assign it to all single letters.
            // the only other variable this uses is always true
            const p = {env: {}};

            for (let i = 65; i <= 90; i++) {
                context[String.fromCharCode(i)] = p;
                context[String.fromCharCode(i).toLowerCase()] = p;
            }

            app_env = vm.runInNewContext('(' + env_str + ')', context, {
                filename: url.toString(),
                timeout: 1000,
            });

            console.warn('Found app environment in %s at %d', url, env_match.index, app_env);
        } else {
            console.warn('Failed to find end of app environment', env_match.index);
        }
    }
}

for (const url of script_urls) {
    const response = await fetch(url, {
        headers,
    });
    const data = new Uint8Array(await response.arrayBuffer());
    const body = new TextDecoder().decode(data);

    console.warn('Downloading asset', url.href);

    if (body.startsWith('self.__BUILD_MANIFEST=')) {
        console.warn('Found build manifest at %s', url);

        build_manifest_url = url;
        build_manifest_headers = {
            'last-modified': response.headers.get('last-modified'),
            'etag': response.headers.get('etag'),
        };
        build_manifest_hash_sha256 = createHash('sha256').update(body).digest('hex');

        const context = vm.createContext({});
        context.self = context;

        vm.runInContext(body, context, {
            timeout: 1000,
        });

        if (!context.__BUILD_MANIFEST) {
            throw new Error('Build manifest not set');
        }

        build_manifest = context.__BUILD_MANIFEST;
    }

    const formatted_js = beautify(body);

    extractEnvFromJs(null, url, formatted_js);

    if (build_manifest && app_env) break;
}

if (build_manifest && !app_env) {
    console.warn('Searching build manifest for app environment');
    for (const route of Object.keys(build_manifest)) {
        if (!route.startsWith('/')) continue;

        for (const asset_url of build_manifest[route]) {
            if (!asset_url.endsWith('.js')) continue;

            const url = new URL('_next/' + asset_url, html_url);

            console.warn('Downloading asset', url.href);

            const response = await fetch(url, {
                headers,
            });
            const js = await response.text();

            const formatted_js = beautify(js);

            extractEnvFromJs(asset_url, url, formatted_js);

            if (app_env) break;
        }
    }
}

if (!app_env) {
    throw new Error('Could not find app environment in any JavaScript source code');
}
if (!build_manifest) {
    throw new Error('Could not find build manifest in any JavaScript source code');
}

const result = {
    version: app_env.VERSION,
    revision: app_env.GIT_COMMIT_HASH,
    app_env,

    build_id: next_data?.buildId,
    build_manifest,

    html_url: html_url.toString(),
    html_sha256: createHash('sha256').update(html_body).digest('hex'),
};

console.log(JSON.stringify(result, null, 4));
