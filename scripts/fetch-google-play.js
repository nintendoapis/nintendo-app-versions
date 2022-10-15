import googleplay from 'google-play-scraper';

const data = await googleplay.app({
    appId: process.argv[2],
    lang: 'en_GB',
    country: 'GB',
});

const result = {
    version: data.version,
    updated_at: new Date(data.updated).toString(),
    result: {
        ...data,
        score: null,
        scoreText: null,
        ratings: null,
        reviews: null,
        histogram: null,
        comments: null,
    },
};

console.log(JSON.stringify(result, null, 4));
