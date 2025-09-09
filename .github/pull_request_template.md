## 概要
- 目的/背景:

## 変更内容
- [ ] フロント: WSオートリコネクト
- [ ] バックエンド: Bedrock ストリーミング(DELTA/END)
- [ ] エラー通知: ERROR→END
- [ ] CDK: BEDROCK_MODEL_ID コンテキスト化

## 動作確認
- [ ] PENDING→DELTA→END
- [ ] クオータ超過でERROR表示
- [ ] 再接続で復帰

## デプロイ
- [ ] `cdk deploy -c bedrockModelId=...`