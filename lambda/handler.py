import json
import boto3
import os
import uuid

# Bedrockクライアントの初期化
bedrock_runtime = boto3.client('bedrock-runtime', region_name='ap-northeast-1')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])

def lambda_handler(event, context):
    """
    WebSocket Gatewayからのリクエストを処理するLambdaハンドラー
    """
    route_key = event['requestContext'].get('routeKey')
    connection_id = event['requestContext'].get('connectionId')

    # WebSocket接続時の処理
    if route_key == '$connect':
        # 接続IDをDynamoDBに保存
        table.put_item(Item={'connectionId': connection_id})
        return {'statusCode': 200}
    
    # WebSocket切断時の処理
    elif route_key == '$disconnect':
        # 接続IDをDynamoDBから削除
        table.delete_item(Key={'connectionId': connection_id})
        return {'statusCode': 200}
    
    # WebSocketメッセージ受信時の処理
    elif route_key == '$default':
        try:
            # メッセージボディの解析
            body = json.loads(event['body'])
            code = body.get('code')
            language = body.get('language')
            question = body.get('question')

            

            if not code or not language:
                return {'statusCode': 400, 'body': 'Code and language are required.'}
            
            # WebSocketクライアントにメッセージを送信するためのAPI Gatewayクライアントを初期化
            api_gateway_management_api = boto3.client(
                'apigatewaymanagementapi',
                endpoint_url=os.environ['WEBSOCKET_API_ENDPOINT']
            )

            # レビュー処理中であることをクライアントに通知
            api_gateway_management_api.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps({'status': 'PENDING', 'message': 'レビュー中...'}).encode('utf-8')
            )

            # Bedrockに渡すプロンプトの作成
            prompt = f"""
            あなたはプログラミング初心者のためのAIメンターです。
            以下のコードと質問について、プログラミング言語の特性を踏まえ、初心者にも分かりやすい言葉でレビューしてください。
            - 専門用語は避け、比喩などを使って理解を助けてください。
            - エラーが発生している場合は、その根本原因と修正方法を解説してください。
            - より良い書き方（ベストプラクティス）があれば、その理由とともに提案してください。

            言語: {language}
            質問: {question}

            ```
            {code}
            ```
            """

            # AIモデルの呼び出し（ダミー実装）
            review = f"""
            レビューを依頼してくれてありがとう！
            今回は、入力されたコードを{language}のベストプラクティスに基づいてレビューします。

            **【AIドクターからのレビュー】**
            - 現時点では問題なさそうですね。素晴らしいです！
            - もしエラーが発生している場合は、ログやエラーメッセージを教えてくれると、もっと詳しく診断できますよ。
            - {language}の学習、一緒に頑張っていきましょう！
            """

            # 完了したレビューをクライアントに通知
            api_gateway_management_api.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps({'status': 'COMPLETED', 'review': review}).encode('utf-8')
            )

            return {'statusCode': 200}

        except Exception as e:
            print(f"Error in $default: {e}")
            return {'statusCode': 500}

    return {'statusCode': 405}