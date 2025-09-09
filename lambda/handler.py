import json
import boto3
import os
import uuid
from botocore.exceptions import BotoCoreError, ClientError

# Bedrockクライアントの初期化
bedrock_runtime = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "ap-northeast-1"))
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])
MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20240620-v1:0") 

def _mgmt_api():
    return boto3.client('apigatewaymanagementapi', endpoint_url=os.environ['WEBSOCKET_API_ENDPOINT'])

def _send(api, connection_id: str, payload: dict) -> bool:
    try:
        api.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(payload, ensure_ascii=False).encode('utf-8')
        )
        return True
    except api.exceptions.GoneException:
        # 切断済みなら台帳を掃除
        try:
            table.delete_item(Key={'connectionId': connection_id})
        except Exception:
            pass
        return False

def _stream_bedrock(language: str, question: str, code: str):
    """Claude (Bedrock) のストリームから text チャンクを取り出して yield する"""
    system_prompt = (
        "あなたはプログラミング初心者のためのAIメンターです。専門用語を避け、"
        "【根本原因→修正手順→改善案】の順に短くわかりやすく説明し、最後に"
        "ベストプラクティスを3つだけ箇条書きで提示してください。"
    )
    req = {
        "anthropic_version": "bedrock-2023-05-31",
        "system": system_prompt,
        "temperature": 0.2,
        "max_tokens": 1200,
        "messages": [{
            "role": "user",
            "content": [{
                "type": "text",
                "text": (
                    f"言語: {language}\n"
                    f"質問: {question}\n\n"
                    "レビュー対象コード:\n"
                    f"```{language}\n{code}\n```"
                ),
            }]
        }],
    }

    resp = bedrock_runtime.invoke_model_with_response_stream(
        modelId=MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(req),
    )

    # Bedrockのストリームは event["chunk"]["bytes"] にJSONイベントが入る
    for event in resp["body"]:
        if "chunk" not in event:
            continue
        payload = json.loads(event["chunk"]["bytes"])

        # Anthropic系: content_block_delta → delta.text に増分
        if payload.get("type") == "content_block_delta":
            t = payload.get("delta", {}).get("text")
            if t:
                yield t
            continue

        # 互換フォールバック: content 配列に text が来ることもある
        parts = [c.get("text", "") for c in payload.get("content", []) if c.get("type") == "text"]
        if parts:
            yield "".join(parts)

def lambda_handler(event, context):
    route_key = event['requestContext'].get('routeKey')
    connection_id = event['requestContext'].get('connectionId')

    if route_key == '$connect':
        table.put_item(Item={'connectionId': connection_id})
        return {'statusCode': 200}

    elif route_key == '$disconnect':
        table.delete_item(Key={'connectionId': connection_id})
        return {'statusCode': 200}

    elif route_key == '$default':
        try:
            body = json.loads(event.get('body') or '{}')
            code = body.get('code')
            language = body.get('language')
            question = body.get('question')
            if not code or not language:
                return {'statusCode': 400, 'body': 'Code and language are required.'}

            api = _mgmt_api()

            # 処理開始通知
            if not _send(api, connection_id, {"status": "PENDING", "message": "レビュー中..."}):
                return {'statusCode': 200}
            
            sent_any = False  # 途中まで配信したかを記録

            # ストリームで増分配信
            try:
                for delta in _stream_bedrock(language, question, code):
                    if not delta:
                        continue
                    sent_any = True
                    if not _send(api, connection_id, {"status": "DELTA", "text": delta}):
                        break

                # 完了合図
                _send(api, connection_id, {"status": "END"})
                return {'statusCode': 200}
            
            except ClientError as e:
                # Bedrock 側の代表的なコードを人間向けメッセージに変換
                code_ = (e.response.get("Error", {}) or {}).get("Code", "ClientError")
                if code_ in ("ThrottlingException", "TooManyRequestsException", "ServiceQuotaExceededException"):
                    msg = "現在Bedrockが混み合っています。数十秒おいて再度お試しください。"
                elif code_ in ("ModelTimeoutException",):
                    msg = "モデル応答がタイムアウトしました。少し待ってから再実行してください。"
                else:
                    msg = f"Bedrock呼び出しでエラーが発生しました（{code_}）。ログを確認してください。"

                # エラー通知 → 終了合図
                _send(api, connection_id, {"status": "ERROR", "message": msg, "partial": sent_any})
                _send(api, connection_id, {"status": "END"})
                return {'statusCode': 502}

            except (BotoCoreError, ClientError) as e:
                _send(api, connection_id, {"status": "ERROR", "message": "内部エラーが発生しました。ログを確認してください。"})
                _send(api, connection_id, {"status": "END"})
                return {'statusCode': 500}

        except Exception as e:
            print(f'Error in $default: {e}')
            return {'statusCode': 500}

    return {'statusCode': 405}