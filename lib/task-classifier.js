const { complete } = require('./llm-router');

const THRESHOLDS = {
  INSTANT: { max: 2, label: 'instant' },
  LIGHT:   { max: 5, label: 'light' },
  HEAVY:   { max: 8, label: 'heavy' },
  COMPLEX: { max: 10, label: 'complex' },
};

const CLASSIFY_SYSTEM = `タスクの複雑さを分類してJSONのみ返してください。

スコアリング基準（合計0-10点）：
- 外部操作(0-3): 0=読取のみ, 1=1箇所書込, 3=複数箇所書込
- ステップ数(0-2): 0=1ステップ, 1=2-3, 2=4以上
- 成果物(0-3): 0=テキスト回答, 1=ドキュメント, 2=コード・PR, 3=複数成果物
- エージェント数(0-2): 0=ジェニーのみ, 1=1名, 2=複数名

出力: {"totalScore":0,"weight":"instant|light|heavy|complex","reason":"30文字以内"}
weight: 0-2→instant, 3-5→light, 6-8→heavy, 9-10→complex`;

// settingsOrKey: 後方互換のためstringのapiKeyも受け入れる
async function classifyTask(message, settingsOrKey) {
  const settings = typeof settingsOrKey === 'string'
    ? { anthropicApiKey: settingsOrKey }
    : (settingsOrKey || {});

  // ルールベースで即判定（API不要）
  const instantPatterns = [
    /^(おはよう|こんにちは|こんばんは|ありがとう|お疲れ)/,
    /^(今|現在|最新)の(状況|ステータス|エージェント)/,
    /^(何|どれ|いつ|誰|どこ).{0,10}$/,
  ];
  if (instantPatterns.some((p) => p.test(message.trim()))) {
    return { weight: 'instant', totalScore: 0, reason: '挨拶・簡単な質問' };
  }

  const heavyKeywords = ['調査', 'リサーチ', '分析', '比較', '競合', 'レポート', '報告書', 'まとめて', '作成して', '実装', 'コード', 'PR', '資料', 'ドキュメント', '戦略', '計画'];
  if (heavyKeywords.some((kw) => message.includes(kw))) {
    console.log(`[classifier] heavyキーワード検出: "${message.slice(0, 30)}" → heavy強制`);
    return { weight: 'heavy', totalScore: 7, reason: 'heavyキーワード検出' };
  }

  const agentDelegationPatterns = [
    /[゠-ヿ]{2,}に(確認|調査|作成|実施|報告|依頼|チェック)/,
    /トムに|レンに|テオに|ルカに|カイに|ソフィアに|リクに|レイに|クレアに|ベンに/,
    /に.{1,20}させて/,
    /に.{1,20}してもらって/,
  ];
  if (agentDelegationPatterns.some((p) => p.test(message))) {
    console.log(`[classifier] エージェント委託検出: "${message.slice(0, 30)}" → heavy強制`);
    return { weight: 'heavy', totalScore: 6, reason: 'エージェント委託タスク' };
  }

  const hasAnyKey = settings.geminiApiKey || settings.openaiApiKey || settings.anthropicApiKey;
  if (!hasAnyKey) {
    return { weight: 'light', totalScore: 3, reason: 'APIキー未設定：lightとして処理' };
  }

  try {
    const result = await complete('classify', CLASSIFY_SYSTEM, [{ role: 'user', content: message }], settings);
    const clean = result.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    console.log(`[classifier] "${message.slice(0, 30)}" → ${parsed.weight}(${parsed.totalScore}点): ${parsed.reason}`);
    return parsed;
  } catch (e) {
    console.error('[classifier] エラー:', e.message);
    return { weight: 'light', totalScore: 3, reason: '分類エラー：lightとして処理' };
  }
}

async function checkAmbiguity(message, settingsOrKey) {
  const settings = typeof settingsOrKey === 'string'
    ? { anthropicApiKey: settingsOrKey }
    : (settingsOrKey || {});

  const clearPatterns = [
    /\d+件|\d+個|\d+本/,
    /までに|今日中|今週中/,
    /に.{1,20}させて/,
    /に.{1,20}して/,
    /トム|ソフィア|レン|ベン|カイ|リク|レイ|クレア/,
    /README|PR|コード|実装|デプロイ/,
    /.{2,}の.{2,}(して|をして|を)/,
    /調査|リサーチ|分析|作成|実装|確認|レポート/,
  ];
  if (clearPatterns.some((p) => p.test(message))) {
    return { isAmbiguous: false };
  }

  if (message.length < 10) {
    const hasAnyKey = settings.geminiApiKey || settings.openaiApiKey || settings.anthropicApiKey;
    if (!hasAnyKey) return { isAmbiguous: false };

    try {
      const result = await complete('ambiguity',
        `ユーザーの指示が曖昧かどうか判定してください。
曖昧とは：対象・範囲・成果物が不明確で、実行者が何をすべきか判断できない状態。
JSONのみ返す：{"isAmbiguous":true/false,"question":"曖昧な場合の確認質問（1文）"}
曖昧でなければ：{"isAmbiguous":false}`,
        [{ role: 'user', content: message }],
        settings,
      );
      const clean = result.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      console.log(`[ambiguity] "${message.slice(0, 30)}" → ambiguous=${parsed.isAmbiguous}`);
      return parsed;
    } catch (e) {
      console.error('[ambiguity] エラー:', e.message);
      return { isAmbiguous: false };
    }
  }

  return { isAmbiguous: false };
}

module.exports = { classifyTask, checkAmbiguity, THRESHOLDS };
