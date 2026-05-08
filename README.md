# 暗渠マップ MVP

スマホ散歩向けの静的Webアプリです。全国の地理院タイル上で、管理者が根拠確認した暗渠データだけをGeoJSONから表示します。

## Run

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/`.

`file://`ではGeoJSONの読み込みがブラウザに止められるため、ローカルサーバー経由で確認してください。

## Data

暗渠本体は `data/culverts.geojson` で管理します。公開対象のFeatureは `LineString` または `MultiLineString` とし、次のプロパティを必須にしています。

- `id`
- `name`
- `areaName`
- `description`
- `evidenceRank`
- `sources`
- `lastVerifiedAt`

`evidenceRank` は `A`, `B`, `C` のいずれかです。`sources` は `title`, `url`, `publisher`, `licenseNote` を持つ配列です。

線形は次の優先順で更新します。

1. 自治体や公的GISで公開されている暗渠・緑道・公園の線形
2. 公的資料で範囲を確認したうえでのOpenStreetMap way/relation線形
3. 現地確認または管理者が地図上で多点トレースした暫定線形

OpenStreetMapを線形補正に使ったFeatureは、`lineworkPrecision`, `lineworkSources`, `lineworkNote`, `osmElementIds` を持ちます。存在確認や根拠ランクは引き続き `sources` の自治体資料・公的資料で判断し、OSMは線形補助として扱います。

OSM線形を再取得する場合:

```bash
node scripts/import-osm-linework.mjs
```

OSMデータはODbL 1.0です。公開時はアプリ内の表示とREADMEの両方で `OpenStreetMap contributors` の出典を残してください。

## Validate

```bash
node scripts/validate-geojson.mjs
```

この検証ではGeoJSON構造、必須プロパティ、根拠ランク、出典URL、座標範囲を確認します。

## Sources And Attribution

背景地図はリアルタイム読み込みの地理院タイルを使用し、アプリ内に出典リンクを常時表示します。

- 地理院タイル一覧: https://maps.gsi.go.jp/development/ichiran.html
- MapLibre GL JS: https://maplibre.org/maplibre-gl-js/docs/
- OpenStreetMap copyright and license: https://www.openstreetmap.org/copyright

初期暗渠データの出典は各Featureの `sources` に記録しています。公開データを追加する場合は、データセットごとに利用規約と出典表記を確認し、GeoJSONとこのREADMEを更新してください。

## Design Concept

実装前のUIコンセプトは `assets/ui-concept.png` に保存しています。実装はこのコンセプトの、全画面地図、上部検索、現在地/レイヤーボタン、下部詳細シート、常時出典表示を反映しています。
