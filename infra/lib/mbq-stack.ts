import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Stack, type StackProps, Duration, RemovalPolicy, CfnOutput, Tags,
  aws_ec2 as ec2, aws_rds as rds, aws_secretsmanager as sm, aws_lambda as lambda,
  aws_logs as logs, aws_s3 as s3, aws_s3_deployment as s3deploy,
  aws_cloudfront as cf, aws_cloudfront_origins as origins, triggers,
} from 'aws-cdk-lib';
import { NodejsFunction, OutputFormat, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { HttpApi, HttpMethod, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { Construct } from 'constructs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');

export interface MbqStackProps extends StackProps { stage: 'staging' | 'prod' }

/**
 * Browser → CloudFront ─┬─ /*      → S3 (the React app)
 *                       └─ /api/*  → API Gateway → Lambda (Fastify) → RDS PostgreSQL
 * Lambda and RDS sit in isolated subnets with no internet access; Lambda reaches
 * Secrets Manager through a VPC endpoint. No NAT gateway, to keep cost down.
 */
export class MbqStack extends Stack {
  constructor(scope: Construct, id: string, props: MbqStackProps) {
    super(scope, id, props);
    const prod = props.stage === 'prod';
    Tags.of(this).add('app', 'my-big-quest');
    Tags.of(this).add('stage', props.stage);

    // ---------- network ----------
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }],
    });
    const isolated = { subnetType: ec2.SubnetType.PRIVATE_ISOLATED };
    vpc.addInterfaceEndpoint('SecretsManager', { service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER, subnets: isolated });

    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', { vpc, description: 'API and migration Lambdas' });
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', { vpc, description: 'PostgreSQL', allowAllOutbound: false });
    dbSg.addIngressRule(lambdaSg, ec2.Port.tcp(5432), 'Lambdas to Postgres');

    // ---------- database ----------
    const db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc, vpcSubnets: isolated, securityGroups: [dbSg],
      credentials: rds.Credentials.fromGeneratedSecret('mbq_admin'),
      databaseName: 'mbq',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: Duration.days(prod ? 14 : 3),
      deletionProtection: prod,
      removalPolicy: prod ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      parameters: { 'rds.force_ssl': '1' },
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
    });

    // ---------- app secrets (generated; nothing secret lives in the repo) ----------
    const adminSecret = new sm.Secret(this, 'AdminSecret', {
      description: 'My Big Quest admin page password (key: adminPassword)',
      generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'adminPassword', passwordLength: 24, excludePunctuation: true },
    });
    const appSecret = new sm.Secret(this, 'AppSecret', {
      description: 'My Big Quest token signing key (key: jwtSecret)',
      generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'jwtSecret', passwordLength: 64, excludePunctuation: true },
    });

    // ---------- Lambdas ----------
    const fnDefaults: NodejsFunctionProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      vpc, vpcSubnets: isolated, securityGroups: [lambdaSg],
      depsLockFilePath: join(ROOT, 'package-lock.json'),
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        minify: true,
        sourceMap: true,
        // ESM bundles need a require() shim for CommonJS deps like pg.
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        externalModules: ['@aws-sdk/*', 'pg-native'],
        forceDockerBundling: false,
      },
      environment: { NODE_OPTIONS: '--enable-source-maps', DB_SECRET_ARN: db.secret!.secretArn },
      logGroup: new logs.LogGroup(this, 'FnLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
    };

    const apiFn = new NodejsFunction(this, 'ApiFn', {
      ...fnDefaults,
      entry: join(ROOT, 'api', 'src', 'lambda.ts'),
      memorySize: 512,
      timeout: Duration.seconds(15),
      environment: { ...fnDefaults.environment, ADMIN_SECRET_ARN: adminSecret.secretArn, APP_SECRET_ARN: appSecret.secretArn },
    });
    db.secret!.grantRead(apiFn);
    adminSecret.grantRead(apiFn);
    appSecret.grantRead(apiFn);

    // Runs the schema migrations after the database is ready, on every deploy that changes the code.
    const migrateFn = new NodejsFunction(this, 'MigrateFn', {
      ...fnDefaults,
      entry: join(ROOT, 'api', 'src', 'migrate.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.minutes(2),
    });
    db.secret!.grantRead(migrateFn);
    new triggers.Trigger(this, 'MigrateOnDeploy', { handler: migrateFn, executeAfter: [db], executeOnHandlerChange: true, timeout: Duration.minutes(3) });

    // ---------- HTTP API ----------
    const httpApi = new HttpApi(this, 'HttpApi', { description: 'My Big Quest API' });
    httpApi.addRoutes({ path: '/api/{proxy+}', methods: [HttpMethod.ANY], integration: new HttpLambdaIntegration('ApiIntegration', apiFn) });
    const apiStage = httpApi.defaultStage!.node.defaultChild as CfnStage;
    apiStage.defaultRouteSettings = { throttlingRateLimit: 50, throttlingBurstLimit: 100 };

    // ---------- frontend ----------
    const site = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Send app routes like /mentors to index.html; leave files (with a dot) alone.
    const spaRewrite = new cf.Function(this, 'SpaRewrite', {
      runtime: cf.FunctionRuntime.JS_2_0,
      code: cf.FunctionCode.fromInline(`function handler(event) {
  var r = event.request;
  if (r.uri.indexOf('.') === -1) r.uri = '/index.html';
  return r;
}`),
    });

    const apiOrigin = new origins.HttpOrigin(`${httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`);
    const distribution = new cf.Distribution(this, 'Cdn', {
      comment: `My Big Quest (${props.stage})`,
      defaultRootObject: 'index.html',
      priceClass: cf.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cf.ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: [{ function: spaRewrite, eventType: cf.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cf.AllowedMethods.ALLOW_ALL,
          cachePolicy: cf.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cf.ResponseHeadersPolicy.SECURITY_HEADERS,
        },
      },
    });

    const dist = join(ROOT, 'web', 'dist');
    if (!existsSync(join(dist, 'index.html'))) throw new Error('web/dist is missing. Run "npm run build -w web" before cdk synth/deploy.');
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(dist)],
      destinationBucket: site,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });

    new CfnOutput(this, 'Url', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'AdminPasswordSecret', { value: adminSecret.secretName, description: 'Read the admin password from this Secrets Manager secret' });
    new CfnOutput(this, 'DbEndpoint', { value: db.dbInstanceEndpointAddress });
  }
}
