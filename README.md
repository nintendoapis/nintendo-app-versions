Nintendo app versions
===

This repository contains the latest release data of the Nintendo Switch Online (Coral) and Nintendo Switch Parental Controls (Moon) apps from iTunes, Google Play and Nintendo's websites. This data is updated automatically every day at 04:00 UTC.

New releases are posted to [#nintendo-app-versions](https://discord.com/channels/998657768594608138/998659415462916166) on Discord: https://discord.com/invite/4D82rFkXRv.

You can use the `?coralupdates` and `?moonupdates` commands in this server to assign the `Coral updates` and `Moon updates` roles to yourself to get notifications when new versions of these apps are released.

If you are creating something that uses the APIs for these apps, you can fetch the current version number from this repository, however I would not recommend auto-updating version numbers as updates may change the behaviour of these apps, which will result in your project sending invalid or incorrect requests without any changes. (Use [coral-google-play.json](data/coral-google-play.json) if you are reporting to be the Nintendo Switch Online app on Android. Other projects shouldn't do this as they also send the build number in the User-Agent header, which isn't available at all without downloading the app.) Also feel free to share your project and ask for help using Nintendo's APIs on my Discord server :).
