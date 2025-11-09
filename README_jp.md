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

Cloud Music Boxは、クラウドストレージ(`OneDrive`, `Google Drive`)から音楽を再生、より音楽を感じ楽しむように設計されたPWA音楽プレイヤーです。

以下の特徴を持ちます。

* PWAとして、多くのプラットフォーム(`Windows`, `macOS`, `iOS`, `Android`)上で同様のユーザ体験を実現
* 一元管理されたクラウドストレージからの再生で、プレイヤーごとに音楽を同期する必要なし
* オフラインでも、ダウンロード済みの音楽は再生可能
* アプリがバックグラウンドにある場合でも、音楽の連続再生が可能(iOSのみ動作しないことがある)
* 独自の非線形ビジュアライザを備え、プレイヤー全体が音楽に合わせてダイナミックに変化

> [!WARNING]
> メジャーアップデート時にデータベースの互換性がなくなり、アプリをリセットする必要が出る場合があります。
>
> アプリの設定画面から`Reset App`を実行することでリセットできます。それでも解決しない場合は、アプリを再インストールしてください。

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

## サポート

このアプリを気に入っていただけたら、コーヒー1杯分の支援を検討してください。ありがとうございます！

<a href="https://www.buymeacoffee.com/contentsviewer" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217">
</a>
