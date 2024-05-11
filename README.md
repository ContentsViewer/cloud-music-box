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

Cloud Music Box is a PWA music player that plays music from cloud storage (currently only `OneDrive`).

It has the following features:

* As a PWA, it provides a similar user experience on many platforms (`Windows`, `macOS`, `iOS`, `Android`).
* It plays from centrally managed cloud storage, so there is no need to sync music for each player.
* Even offline, music that has been downloaded can be played.
* Even when the app is in the background, music can be played automatically (only on `iOS`, operation depends on Safari).
* The style and animation of the app change dynamically according to the music.

> [!WARNING]
> Currently, this app is in alpha version.
>
> Compatibility with the database may be lost when updating, and you may need to reinstall the app.

## Development

### Getting Started with Development

```sh
npm install
npm run dev
```
