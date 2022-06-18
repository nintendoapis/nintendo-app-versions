import fetch from 'node-fetch';

const url = new URL('https://itunes.apple.com/lookup');
url.searchParams.append('id', process.argv[2]);
url.searchParams.append('country', 'GB');

const response = await fetch(url);
const data = await response.json();

const result = {
    result: data.results[0],
};

console.log(JSON.stringify(result, null, 4));
