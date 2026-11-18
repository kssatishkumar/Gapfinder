import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Stack, type StackProps, Duration, RemovalPolicy, CfnOutput, Tags, Fn,
  aws_ec2 as ec2, aws_rds as rds, aws_lambda as lambda, aws_cognito as cognito,
  aws_logs as logs, aws_s3 as s3, aws_s3_deployment as s3deploy,
  aws_cloudfront as cf, aws_cloudfront_origins as origins, triggers,
} from 'aws-cdk-lib';
import { NodejsFunction, OutputFormat, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { HttpApi, HttpMethod, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import type { Construct } from 'constructs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const ADMIN_GROUP = 'admins'; // must match ADMIN_GROUP in api/src/auth.ts

export interface MbqStackProps extends StackProps {
  stage: 'staging' | 'prod';
  /** If set, this person is created as the first admin and gets an invite email from Cognito. */
  adminEmail?: string;
}

/**
 * Browser → CloudFront ─┬─ /*            → S3 (the React app)
 *                       ├─ /api/admin/*  → API Gateway (Cognito authorizer) → Lambda → RDS
 *                       └─ /api/*        → API Gateway → Lambda (Fastify) → RDS PostgreSQL
 * Admins sign in on Cognito's hosted login page. Lambda and RDS sit in isolated subnets with
 * no internet access; Lambda reaches Secrets Manager through a VPC endpoint. No NAT gateway.
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
    });
    db.secret!.grantRead(apiFn);

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

    // ---------- HTTP API (routes are added below, once Cognito exists) ----------
    const httpApi = new HttpApi(this, 'HttpApi', { description: 'My Big Quest API' });
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
    const apiBehavior: cf.BehaviorOptions = {
      origin: apiOrigin,
      viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cf.AllowedMethods.ALLOW_ALL,
      cachePolicy: cf.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: cf.ResponseHeadersPolicy.SECURITY_HEADERS,
    };
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
      additionalBehaviors: { '/api/*': apiBehavior },
    });
    const siteUrl = `https://${distribution.distributionDomainName}`;

    // ---------- admin sign-in (Cognito) ----------
    const userPool = new cognito.UserPool(this, 'AdminUsers', {
      userPoolName: `my-big-quest-admins-${props.stage}`,
      selfSignUpEnabled: false, // admins are invited, nobody can sign up
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false, tempPasswordValidity: Duration.days(7) },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userInvitation: {
        emailSubject: 'Your My Big Quest admin account',
        emailBody: `You've been added as an admin for My Big Quest (${props.stage}). Sign in at ${siteUrl}/admin with your email address {username} and this temporary password: {####}`,
      },
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const adminsGroup = new cognito.CfnUserPoolGroup(this, 'AdminsGroup', { userPoolId: userPool.userPoolId, groupName: ADMIN_GROUP, description: 'Can use /admin' });

    // Hosted login page at https://mbq-<stage>-<account>.auth.<region>.amazoncognito.com
    const domain = userPool.addDomain('LoginDomain', {
      cognitoDomain: { domainPrefix: Fn.join('-', ['mbq', props.stage, this.account]) },
    });

    const callbackUrls = [`${siteUrl}/admin`, ...(prod ? [] : ['http://localhost:5173/admin'])];
    const client = userPool.addClient('AdminWeb', {
      generateSecret: false, // browser app: public client with PKCE
      authFlows: { userSrp: true },
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL], callbackUrls, logoutUrls: callbackUrls },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      accessTokenValidity: Duration.hours(8),
      idTokenValidity: Duration.hours(8),
      refreshTokenValidity: Duration.days(1),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
    });

    if (props.adminEmail) {
      const user = new cognito.CfnUserPoolUser(this, 'FirstAdmin', {
        userPoolId: userPool.userPoolId,
        username: props.adminEmail,
        userAttributes: [{ name: 'email', value: props.adminEmail }, { name: 'email_verified', value: 'true' }],
        desiredDeliveryMediums: ['EMAIL'],
      });
      const membership = new cognito.CfnUserPoolUserToGroupAttachment(this, 'FirstAdminInGroup', { userPoolId: userPool.userPoolId, groupName: ADMIN_GROUP, username: props.adminEmail });
      membership.node.addDependency(user, adminsGroup);
    }

    apiFn.addEnvironment('COGNITO_CLIENT_ID', client.userPoolClientId);
    apiFn.addEnvironment('COGNITO_DOMAIN', domain.baseUrl());

    // ---------- API routes ----------
    // API Gateway checks the Cognito token on every /api/admin/* call before the Lambda runs.
    const integration = new HttpLambdaIntegration('ApiIntegration', apiFn);
    httpApi.addRoutes({ path: '/api/{proxy+}', methods: [HttpMethod.ANY], integration });
    httpApi.addRoutes({
      path: '/api/admin/{proxy+}',
      methods: [HttpMethod.ANY],
      integration,
      authorizer: new HttpUserPoolAuthorizer('AdminAuthorizer', userPool, { userPoolClients: [client] }),
    });

    // ---------- site files ----------
    const dist = join(ROOT, 'web', 'dist');
    if (!existsSync(join(dist, 'index.html'))) throw new Error('web/dist is missing. Run "npm run build -w web" before cdk synth/deploy.');
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(dist)],
      destinationBucket: site,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });

    new CfnOutput(this, 'Url', { value: siteUrl });
    new CfnOutput(this, 'AdminUrl', { value: `${siteUrl}/admin` });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId, description: 'Add admins here (Cognito console), in the "admins" group' });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'DbEndpoint', { value: db.dbInstanceEndpointAddress });
  }
}
