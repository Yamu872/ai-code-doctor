import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigatewayv2integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { Construct } from 'constructs';

export class AiCodeDoctorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. フロントエンドホスティング用のS3バケットを作成
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      websiteIndexDocument: 'index.html',
      blockPublicAccess: new s3.BlockPublicAccess({ 
        blockPublicAcls: false, 
        ignorePublicAcls: false, 
        blockPublicPolicy: false, 
        restrictPublicBuckets: false 
      }),
      publicReadAccess: true, // 静的ウェブサイトホスティングのためにパブリックアクセスを許可
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [ // ここにCORS設定を追加
        {
          allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        }
      ],
    });

    // 2. Lambda関数のコードディレクトリ
    const lambdaCodePath = path.join(__dirname, '../lambda');

    // 3. DynamoDBテーブルの作成
    const connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 4. WebSocket API Gatewayを作成 (Lambdaより先に宣言)
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: 'AICodeDoctorWebSocketApi',
    });

    // 5. Lambda関数 (Backend) を定義
    const webSocketLambda = new lambda.Function(this, 'WebSocketLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: connectionsTable.tableName,
        WEBSOCKET_API_ENDPOINT: 'https://' + webSocketApi.apiId + '.execute-api.' + cdk.Stack.of(this).region + '.amazonaws.com/prod',
        BEDROCK_MODEL_ID:
          (this.node.tryGetContext('bedrockModelId') as string)
            ?? 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      },
    });

    // Lambda統合を定義
    const connectIntegration = new apigatewayv2integrations.WebSocketLambdaIntegration('ConnectIntegration', webSocketLambda);
    const disconnectIntegration = new apigatewayv2integrations.WebSocketLambdaIntegration('DisconnectIntegration', webSocketLambda);
    const defaultIntegration = new apigatewayv2integrations.WebSocketLambdaIntegration('DefaultIntegration', webSocketLambda);

    // APIのルートと統合を関連付け
    webSocketApi.addRoute('$connect', { integration: connectIntegration });
    webSocketApi.addRoute('$disconnect', { integration: disconnectIntegration });
    webSocketApi.addRoute('$default', { integration: defaultIntegration });

    // Lambda関数にBedRock系の権限を付与
    connectionsTable.grantReadWriteData(webSocketLambda);
    webSocketLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    webSocketLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));  

    // 接続IDを管理するための許可をLambda関数に追加
    webSocketApi.grantManageConnections(webSocketLambda);

    // 6. WebSocketのデプロイメントとステージを定義
    const webSocketStage = new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
        webSocketApi: webSocketApi,
        stageName: 'prod',
        autoDeploy: true,
    });

    new cdk.CfnOutput(this, 'WebSocketApiUrl', {
      value: webSocketStage.url,
      description: 'The URL of the WebSocket API endpoint.',
    });

    // 7. フロントエンドのビルド済みファイルをS3にデプロイ
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../frontend/build'))],
      destinationBucket: websiteBucket,
    });

    // 8. S3ウェブサイトのエンドポイントとAPI GatewayのURLをCfn出力
    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: websiteBucket.bucketWebsiteUrl,
      description: 'The URL of the S3 website endpoint.',
    });
  }
}
