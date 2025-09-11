
# AI Code Doctor — デプロイ手順（AWS CDK）＆運用ガイド

このリポジトリは **CDK(TypeScript)** + **React(Frontend)** + **Lambda(Python)** + **API Gateway WebSocket** + **DynamoDB** + **Bedrock(ストリーミング)** 構成です。  
以下の手順で初めての人でもデプロイできます。

---

## 1) 事前準備

- Node.js 18+ / npm（またはpnpm/yarn）
- AWS CLI（`aws configure` 済み）
- AWS CDK v2  
  ```bash
  npm i -g aws-cdk@^2
  ```
- Bedrock **モデルアクセス有効化**（Bedrock コンソール → *Model access* で対象モデルを許可）

> 初回のみ **CDK bootstrap** が必要：
```bash
export AWS_ACCOUNT_ID=<あなたのAWSアカウントID>
export AWS_REGION=ap-northeast-1
cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
```

---

## 2) このスタックが作るもの

- S3（静的ウェブサイト）— `frontend/build` を配信
- API Gateway WebSocket（stage: `prod`）— ルート `$connect` / `$default` / `$disconnect`
- Lambda（Python）— WebSocket受信、**Bedrockストリーミング**呼び出し、DELTA配信
- DynamoDB — `connectionId` を保存

**Lambda 環境変数（CDKで注入）**
- `TABLE_NAME`
- `WEBSOCKET_API_ENDPOINT` … `https://<apiId>.execute-api.ap-northeast-1.amazonaws.com/prod`
- `BEDROCK_MODEL_ID` … 既定 `anthropic.claude-3-5-sonnet-20240620-v1:0`（`-c bedrockModelId=...` で変更可）

---

## 3) デプロイ（ローカル）

```bash
# 0) リポジトリ直下で
npm ci

# 1) フロントエンドをビルド
cd frontend
npm ci
npm run build
cd ..

# 2) CDK 合成
npx cdk synth

# 3) デプロイ（モデルIDを切り替えたい場合は -c で上書き）
BEDROCK_MODEL_ID="anthropic.claude-3-5-sonnet-20240620-v1:0"
npx cdk deploy --require-approval never -c bedrockModelId=${BEDROCK_MODEL_ID}
```

**Outputs（完了後に表示）**
- `WebsiteURL` … S3静的サイトURL  
- `WebSocketApiUrl` … `wss://<apiId>.execute-api-ap-northeast-1.amazonaws.com/prod`

> フロントに WebSocket のURLを**ハードコード**している場合は、出力の `WebSocketApiUrl` に合わせて `App.js` の `WEBSOCKET_API_URL` を更新 → `npm run build` → `cdk deploy` してください。  
> 後で `config.json` をS3に置いてランタイム読込に切り替えると、再ビルド不要になります。

---

## 4) 片付け（削除）

```bash
npx cdk destroy
```

> 注意：このスタックは学習用に `RemovalPolicy.DESTROY` を使っています。S3の中身やDynamoDBテーブルは**削除**されます。

---

## 5) トラブルシュート

- **`execute-api:ManageConnections` の AccessDenied**  
  → CDKで `webSocketApi.grantManageConnections(lambda)` を付与済み。古いスタックがあるなら再デプロイ。

- **Bedrockのクオータ/スロットリング**  
  → Lambda は `{"status":"ERROR","message":"..."}` → `{"status":"END"}` の順で返します。少し待って再実行を。

- **フロントビルドで `stream/consumers` not found**  
  → フロントに Node専用ライブラリが混入（`@aws-sdk/*`、`node-fetch`、`openai` Node SDK など）。ブラウザ側からは削除。

---

## 6) 便利コマンド

```bash
# モデル切替デプロイ
npx cdk deploy -c bedrockModelId=anthropic.claude-3-5-haiku-20241022-v1:0

# スタック出力を再取得
aws cloudformation describe-stacks --stack-name AiCodeDoctorStack   --query "Stacks[0].Outputs" --output table

# Lambdaログを追う
aws logs tail /aws/lambda/WebSocketLambda --follow --since 1h
```

---
