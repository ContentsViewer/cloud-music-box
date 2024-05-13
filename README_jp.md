# Cloud Music Box

[English](./README.md) | 日本語

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

Cloud Music Boxは、クラウドストレージ(現在は`OneDrive`のみ)から音楽を再生するPWA音楽プレイヤーです。

以下の特徴を持ちます。

* PWAとして、多くのプラットフォーム(`Windows`, `macOS`, `iOS`, `Android`)上で同様のユーザ体験を実現します。
* 一元管理されたクラウドストレージからの再生で、プレイヤーごとに音楽を同期する必要がありません。
* オフラインでも、ダウンロード済みの音楽は再生可能です。
* アプリがバックグラウンドにある場合でも、音楽の連続再生が可能です(iOSのみ動作しないことがある)。
* 音楽に合わせて、動的にアプリのスタイルやアニメーションが変化します。

> [!WARNING]
> 現在、このアプリはアルファ版です。
>
> アップデート時にデータベースの互換性がなくなり、アプリを再インストールする必要があるかもしれません。

## 開発

### 開発を始める

```sh
npm install
npm run dev
```

### 製品版のビルドと動作確認

```sh
npm run build
npx serve@latest out
```

## さらなる情報

* [Home Page](https://contentsviewer.work/Master/apps/cloud-music-box/docs)
