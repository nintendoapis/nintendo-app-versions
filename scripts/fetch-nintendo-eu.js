import fetch from 'node-fetch';
import { load } from 'cheerio';

const url = 'https://www.nintendo.co.uk/-' + process.argv[2] + '.html';

const response = await fetch(url);
const body = await response.text();

const $ = load(body);

const versions = $('a').filter(function () {
    return $(this).text().trim().match(/\bver\.?\b/i);
});

if (!versions.length) {
    throw new Error('No versions found');
}

console.warn('Found %d versions', versions.length);

const result = {
    versions: versions.toArray().map(e => {
        return {
            version: $(e).text().match(/\d+\.\d+(\.\d+)?/)?.[0] ?? null,
            label: $(e).text(),
            release_notes_html: $($(e).attr('data-target')).toString(),
        };
    }),
    url: response.url,
};

console.log(JSON.stringify(result, null, 4));
