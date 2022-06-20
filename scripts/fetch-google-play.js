import fetch from 'node-fetch';
import { load } from 'cheerio';
import { ElementType } from 'htmlparser2';

const url = new URL('https://play.google.com/store/apps/details');
url.searchParams.append('id', process.argv[2]);
url.searchParams.append('hl', 'en_GB');
url.searchParams.append('gl', 'GB');

const response = await fetch(url);
const body = await response.text();

const $ = load(body);

const updated_on_label = $('*').filter(function () {
    return $(this).contents().toArray().find(n => n.type === ElementType.Text && n.data.trim().match(/updated on/i));
});

if (updated_on_label.length !== 1) {
    throw new Error('Could not find updated label');
}

const updated_on = updated_on_label.next();

console.warn(
    'Found updated label',
    JSON.stringify(updated_on_label.text()),
    JSON.stringify(updated_on.text())
);

const date = new Date(updated_on.text());

const version = (() => {
    for (const script of $('script')) {
        const text = $(script).text();
        const match = text.match(/"(\d+\.\d+\.\d+)"/);
        if (!match) continue;
        
        console.warn('Found version number', match[0]);
        return match[1];
    }

    throw new Error('Could not find version number');
})();

const result = {
    version,
    updated_at: date.toString(),
};

console.log(JSON.stringify(result, null, 4));
