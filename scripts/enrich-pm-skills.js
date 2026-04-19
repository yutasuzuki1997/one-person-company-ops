'use strict';
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'core', 'skills', 'agents');

// プロジェクト固有チェックリスト（PM補佐の md 末尾に追記）
const PROJECT_APPENDIX = {
  'agent-1': { // シバ太 / WAVERS
    project: 'WAVERS',
    body: `
## プロジェクト固有チェックリスト（WAVERS）

| 項目 | 確認ポイント |
|------|---------|
| 差別化軸 | 競合（Spotify / Apple Music / Instagram）と比較した WAVERS 独自価値の1行定義 |
| 主要 KPI | DAU / 新規登録 / プレイリスト作成数 / 再生完了率 |
| 競合調査発注先 | ジェシー（リサーチ）→ reports/wavers-competitor-{YYYY-MM-DD}.md |
| 審査ガイド | https://developer.apple.com/app-store/review/guidelines/ |
| Sprint スケジュール | 2週間スプリント。火曜キックオフ・火曜レビュー |
| データソース | Mixpanel ダッシュボード（label="wavers"） |

## 週次やること
1. 前スプリントの KPI 差分を要約し、ティアラ（上長）に DIVISION_REPORT
2. 次スプリントの優先3機能を memory/projects.md/WAVERS に書く
`
  },
  'agent-2': { // ゴルディ / あげファンズ
    project: 'あげファンズ',
    body: `
## プロジェクト固有チェックリスト（あげファンズ）

| 項目 | 確認ポイント |
|------|---------|
| コア体験 | 「ファンが投げ銭できる」フローの完了率 |
| 計測設計 | GA4 + Mixpanel 二重計測中。重複除外は client_id 基準 |
| 主要 KPI | 投げ銭件数 / 初回投げ銭までの平均時間 / 復帰率 |
| 決済 | Stripe 本番アカウント未連携（要確認） |
| 担当リポジトリ | backstage-inc/agefunds |

## 週次やること
1. Mixpanel から投げ銭ファネルを取得し 3 数値（CVR / AOV / 復帰率）
2. 新機能アイデアを 2 案、Yuta の判断材料として並べて渡す
`
  },
  'agent-3': { // ダッキー / NoBorder
    project: 'NoBorder App',
    body: `
## プロジェクト固有チェックリスト（NoBorder）

| 項目 | 確認ポイント |
|------|---------|
| 対応言語 | 日/英/中（簡体）/韓 を最低ライン |
| ローカライズ品質 | i18n キーの欠落率 5% 未満 |
| 主要 KPI | 非日本語 MAU 比率 / 各言語ロケール別 CVR |
| 担当リポジトリ | backstage-inc/noborder, backstage-inc/noborder-news |
| データソース | GA4 プロパティ noborder_prod |

## 週次やること
1. 英中韓それぞれの MAU / CVR を 1 表にまとめる
2. ローカライズ抜け漏れを reports/noborder-i18n-gaps-{YYYY-MM-DD}.md
`
  },
  'agent-4': { // ボーディ / RealValue
    project: 'RealValue',
    body: `
## プロジェクト固有チェックリスト（RealValue）

| 項目 | 確認ポイント |
|------|---------|
| バリュエーション算出 | DCF / マルチプル法 両対応。想定モデルの前提を 1 段落で言語化 |
| 金融データソース | Yahoo Finance API / EDINET（日本決算）連携中 |
| 主要 KPI | 解析完了企業数 / レポート生成時間 / 精度誤差 |
| 決算カレンダー | https://www.jpx.co.jp/listing/event-schedules/financial-announcement/ |
| 担当リポジトリ | backstage-inc/realvalue |

## 週次やること
1. 今週の決算発表企業リストを取得し、重点 3 社を Yuta に提案
2. 算出精度バグがあれば reports/realvalue-accuracy-{YYYY-MM-DD}.md
`
  },
};

let count = 0;
for (const [agentId, appendix] of Object.entries(PROJECT_APPENDIX)) {
  const file = path.join(outDir, `${agentId}.md`);
  if (!fs.existsSync(file)) continue;
  let current = fs.readFileSync(file, 'utf8');
  // 既に追記済みならスキップ
  if (current.includes('プロジェクト固有チェックリスト')) continue;
  current += appendix.body;
  fs.writeFileSync(file, current);
  count++;
  console.log('enriched', agentId, '-', appendix.project);
}
console.log('total enriched:', count);
