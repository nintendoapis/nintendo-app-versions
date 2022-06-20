import fetch from 'node-fetch';
import stringify from 'json-stable-stringify';

const url = new URL('https://itunes.apple.com/lookup');
url.searchParams.append('id', process.argv[2]);
url.searchParams.append('country', 'GB');

const response = await fetch(url);
const data = await response.json();

const result = {
    result: data.results[0],
};

console.log(stringify(result, {space: 4}));
