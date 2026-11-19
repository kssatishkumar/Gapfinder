import { createHash } from 'node:crypto';
import {
  Stack, type StackProps, Duration, RemovalPolicy, CfnOutput, Tags, Fn,
  aws_s3 as s3, aws_cloudfront as cf, aws_cloudfront_origins as origins,
  aws_dynamodb as ddb, aws_apigateway as apigw, aws_iam as iam, aws_cognito as cognito,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { sessionPutSchema, feedbackPostSchema, mentorRequestPostSchema, requestStatusSchema, type JsonSchema } from '@mbq/shared';
import * as T from './templates';

/** [API Gateway response type, status, message] for errors API Gateway answers itself. */
const GATEWAY_ERRORS: [string, string, string][] = [
  ['UNAUTHORIZED', '401', 'Not signed in'],
  ['ACCESS_DENIED', '403', 'Not allowed'],
  ['MISSING_AUTHENTICATION_TOKEN', '404', 'Not found'],
  ['THROTTLED', '429', 'Too many requests, try again in a moment'],
  ['DEFAULT_5XX', '500', 'Something went wrong'],
];

export interface MbqStackProps extends StackProps {
  stage: 'staging' | 'prod';
  /** If set, this person is created as the first admin and gets an invite email from Cognito. */
  adminEmail?: string;
}

/**
 * No servers and no Lambda functions:
 *
 * Browser → CloudFront ─┬─ /*      → S3 (the React app, uploaded by scripts/deploy.mjs)
 *                       └─ /api/*  → API Gateway ──(mapping templates)──→ DynamoDB
 *                                     └─ /api/admin/* requires a Cognito sign-in
 *
 * API Gateway validates each request body against the JSON schemas in shared/, then a mapping
 * template turns it into a DynamoDB call (see lib/templates.ts).
 */
export class MbqStack extends Stack {
  constructor(scope: Construct, id: string, props: MbqStackProps) {
    super(scope, id, props);
    const prod = props.stage === 'prod';
    Tags.of(this).add('app', 'my-big-quest');
    Tags.of(this).add('stage', props.stage);

    // ---------- data ----------
    const table = (name: string) => new ddb.Table(this, name, {
      partitionKey: { name: 'id', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: prod },
      deletionProtection: prod,
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const sessions = table('QuizSessions');
    const feedback = table('Feedback');
    const requests = table('MentorRequests');

    // ---------- site bucket and CDN ----------
    const site = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Kept on stack deletion: emptying a bucket automatically would need a Lambda.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---------- admin sign-in (Cognito). Everyone in this pool is an admin. ----------
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
      // No site URL in this text: the pool is created before CloudFront (CloudFront → API → authorizer → pool).
      userInvitation: {
        emailSubject: 'Your My Big Quest admin account',
        emailBody: `You've been added as an admin for My Big Quest (${props.stage}). Open the site's /admin page and sign in with your email address {username} and this temporary password: {####}`,
      },
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const domain = userPool.addDomain('LoginDomain', {
      cognitoDomain: { domainPrefix: Fn.join('-', ['mbq', props.stage, this.account]) },
    });

    // ---------- API Gateway → DynamoDB ----------
    const api = new apigw.RestApi(this, 'Api', {
      restApiName: `my-big-quest-${props.stage}`,
      description: 'My Big Quest API: request validation + direct DynamoDB integrations, no Lambda',
      cloudWatchRole: false,
      endpointTypes: [apigw.EndpointType.REGIONAL],
      deployOptions: { stageName: 'live', throttlingRateLimit: 20, throttlingBurstLimit: 40, metricsEnabled: true },
    });

    // Changes only reach the live stage through a new API Gateway deployment, and CDK doesn't notice
    // edits to mapping templates, models or gateway responses. Hash them into the deployment's id so
    // any change to them creates a new deployment.
    const BAD_BODY = '{"error": "Invalid request", "detail": "$util.escapeJavaScript($context.error.validationErrorString)"}';
    api.latestDeployment?.addToLogicalId(createHash('sha256')
      .update(JSON.stringify([T, sessionPutSchema, feedbackPostSchema, mentorRequestPostSchema, requestStatusSchema, BAD_BODY, GATEWAY_ERRORS]))
      .digest('hex'));

    // Consistent JSON errors for requests API Gateway rejects itself.
    const gatewayError = (type: apigw.ResponseType, status: string, message: string) =>
      api.addGatewayResponse(`Err${status}${type.responseType}`, { type, statusCode: status, templates: { 'application/json': `{"error": "${message}"}` } });
    // Gateway responses don't support chained calls like .replaceAll(), so only escapeJavaScript here.
    const responses = [
      api.addGatewayResponse('ErrBadBody', { type: apigw.ResponseType.BAD_REQUEST_BODY, statusCode: '400', templates: { 'application/json': BAD_BODY } }),
      ...GATEWAY_ERRORS.map(([type, status, message]) => gatewayError(apigw.ResponseType.of(type), status, message)),
    ];
    // A deployment snapshots the API when it's created, so it must come after the gateway responses.
    for (const r of responses) api.latestDeployment?.node.addDependency(r);

    const validator = new apigw.RequestValidator(this, 'BodyValidator', { restApi: api, validateRequestBody: true, validateRequestParameters: true });
    const model = (name: string, schema: JsonSchema) =>
      api.addModel(name, { modelName: name, contentType: 'application/json', schema: schema as apigw.JsonSchema });

    const role = new iam.Role(this, 'ApiDynamoRole', { assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'), description: 'Lets API Gateway write and read the app tables' });
    role.addToPolicy(new iam.PolicyStatement({ actions: ['dynamodb:UpdateItem'], resources: [sessions.tableArn, requests.tableArn] }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ['dynamodb:PutItem'], resources: [feedback.tableArn, requests.tableArn] }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ['dynamodb:Scan'], resources: [sessions.tableArn, feedback.tableArn, requests.tableArn] }));

    const json = (status: string) => ({ statusCode: status, responseModels: { 'application/json': apigw.Model.EMPTY_MODEL } });
    const dynamo = (action: string, requestTemplate: string, ok: { status: string; template: string }, clientError = '{"error": "Invalid request"}') =>
      new apigw.AwsIntegration({
        service: 'dynamodb',
        action,
        options: {
          credentialsRole: role,
          passthroughBehavior: apigw.PassthroughBehavior.NEVER,
          requestTemplates: { 'application/json': requestTemplate },
          integrationResponses: [
            { statusCode: ok.status, responseTemplates: { 'application/json': ok.template } },
            { statusCode: '400', selectionPattern: '400', responseTemplates: { 'application/json': clientError } },
            { statusCode: '500', selectionPattern: '5\\d{2}', responseTemplates: { 'application/json': T.serverError } },
          ],
        },
      });
    const methodResponses = (ok: string) => [json(ok), json('400'), json('403'), json('404'), json('500')];

    const apiRoot = api.root.addResource('api');

    // Public: save quiz progress, send feedback, ask a mentor.
    apiRoot.addResource('sessions').addMethod('PUT',
      dynamo('UpdateItem', T.sessionPutRequest(sessions.tableName), { status: '200', template: T.sessionPutOk }, T.sessionPutClientError),
      { requestValidator: validator, requestModels: { 'application/json': model('SessionPut', sessionPutSchema) }, methodResponses: methodResponses('200') });
    apiRoot.addResource('feedback').addMethod('POST',
      dynamo('PutItem', T.feedbackPostRequest(feedback.tableName), { status: '201', template: T.createdResponse }),
      { requestValidator: validator, requestModels: { 'application/json': model('FeedbackPost', feedbackPostSchema) }, methodResponses: methodResponses('201') });
    apiRoot.addResource('mentor-requests').addMethod('POST',
      dynamo('PutItem', T.mentorRequestPostRequest(requests.tableName), { status: '201', template: T.createdResponse }),
      { requestValidator: validator, requestModels: { 'application/json': model('MentorRequestPost', mentorRequestPostSchema) }, methodResponses: methodResponses('201') });

    // Admin: needs a Cognito access token in the X-Auth header. (A custom header, because
    // CloudFront only forwards the Authorization header when it's part of the cache key.)
    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'AdminAuthorizer', {
      cognitoUserPools: [userPool],
      identitySource: 'method.request.header.X-Auth',
      resultsCacheTtl: Duration.minutes(5),
    });
    const adminOnly: apigw.MethodOptions = {
      authorizer, authorizationType: apigw.AuthorizationType.COGNITO, authorizationScopes: ['openid'],
    };
    const admin = apiRoot.addResource('admin');
    const scan = (path: string, table: ddb.Table, template: string) =>
      admin.addResource(path).addMethod('GET', dynamo('Scan', T.scanRequest(table.tableName), { status: '200', template }), { ...adminOnly, methodResponses: methodResponses('200') });
    scan('sessions', sessions, T.sessionsScanResponse);
    scan('feedback', feedback, T.feedbackScanResponse);
    const adminRequests = scan('requests', requests, T.requestsScanResponse).resource;
    adminRequests.addResource('{id}').addMethod('PATCH',
      dynamo('UpdateItem', T.requestStatusRequest(requests.tableName), { status: '200', template: T.requestStatusOk }, T.requestStatusClientError),
      { ...adminOnly, requestValidator: validator, requestParameters: { 'method.request.path.id': true },
        requestModels: { 'application/json': model('RequestStatus', requestStatusSchema) }, methodResponses: methodResponses('200') });

    // ---------- CloudFront ----------
    // Send app routes like /mentors to index.html; leave files (with a dot) alone.
    const spaRewrite = new cf.Function(this, 'SpaRewrite', {
      runtime: cf.FunctionRuntime.JS_2_0,
      code: cf.FunctionCode.fromInline(`function handler(event) {
  var r = event.request;
  if (r.uri.indexOf('.') === -1) r.uri = '/index.html';
  return r;
}`),
    });
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
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cf.AllowedMethods.ALLOW_ALL,
          cachePolicy: cf.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cf.ResponseHeadersPolicy.SECURITY_HEADERS,
        },
      },
    });
    const siteUrl = `https://${distribution.distributionDomainName}`;

    // ---------- Cognito app client (needs the site URL for sign-in redirects) ----------
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
      // Later deploys don't pass adminEmail; RETAIN keeps the user instead of deleting them then.
      user.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }

    new CfnOutput(this, 'Url', { value: siteUrl });
    new CfnOutput(this, 'AdminUrl', { value: `${siteUrl}/admin` });
    new CfnOutput(this, 'SiteBucket', { value: site.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId, description: 'Add admins here (Cognito console). Everyone in this pool is an admin.' });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
  }
}
