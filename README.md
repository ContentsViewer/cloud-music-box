# Cloud Music Box

English | [日本語](./README_jp.md)

<p align="center">
    <a href="https://contentsviewer.github.io/cloud-music-box/">
      <img src="./public/icon-512x512.png"/>
    </a>
</p>
<h2 align="center">
    <a href="https://contentsviewer.github.io/cloud-music-box/">Launch App</a>
</h2>
<p align="center">
    <a href="https://contentsviewer.github.io/cloud-music-box/">
      https://contentsviewer.github.io/cloud-music-box/
    </a>
</p>

Cloud Music Box is a PWA music player that plays music from cloud storage (`OneDrive`, `Google Drive`), designed to let you feel and enjoy music more deeply.

It has the following features:

* As a PWA, it provides a similar user experience on many platforms (`Windows`, `macOS`, `iOS`, `Android`).
* It plays from centrally managed cloud storage, so there is no need to sync music for each player.
* Even offline, music that has been downloaded can be played.
* Even when the app is in the background, music can be played sequentially (May not work on iOS only).
* Featuring a unique non-linear visualizer, the entire player dynamically changes in response to the music.

> [!WARNING]
> Database compatibility may be lost during major updates, requiring you to reset the app.
>
> You can reset the app by executing `Reset App` from the app settings screen. If that doesn't resolve the issue, try reinstalling the app.

## Development

### Getting Started with Development

```sh
npm install
npm run dev
```

### Building and testing the production version

```sh
npm run build
npx serve@latest out
```

## Further information

* [Home Page](https://contentsviewer.work/Master/apps/cloud-music-box/docs)

## Support

If you like this app, please consider buying me a coffee. Thank you!

<a href="https://www.buymeacoffee.com/contentsviewer" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217">
</a>
