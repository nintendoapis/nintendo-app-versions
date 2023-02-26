import fetch from 'node-fetch';
import { load } from 'cheerio';

const url = 'https://www.nintendo.co.jp/support/app/' + process.argv[2] + '/index.html';

const response = await fetch(url);
const body = await response.text();

const $ = load(body);

const versions = $('h3').filter(function () {
    return $(this).text().trim().match(/ver\./i);
});

console.warn('Found %d versions', versions.length);

const result = {
    versions: versions.toArray().map(e => {
        return {
            version: $(e).text().match(/\d+\.\d+\.\d+/)?.[0] ?? null,
            label: $(e).text(),
            release_notes_html: $(e).next().toString(),
        };
    }),
    url,
};

console.log(JSON.stringify(result, null, 4));
