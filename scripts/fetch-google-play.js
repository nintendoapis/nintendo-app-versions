import googleplay from 'google-play-scraper';

const data = await googleplay.app({
    appId: process.argv[2],
    lang: 'en_GB',
    country: process.argv[3] || 'GB',
});

if (data.released?.match(/^[a-z]+ \d+, \d+$/i)) {
    throw new Error('Google Play returned data not matching requested language');
}

const result = {
    version: data.version,
    updated_at: new Date(data.updated).toString(),
    result: {
        ...data,
        maxInstalls: null,
        score: null,
        scoreText: null,
        ratings: null,
        reviews: null,
        histogram: null,
        comments: null,
    },
};

console.log(JSON.stringify(result, null, 4));
