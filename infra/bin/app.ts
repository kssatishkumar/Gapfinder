import { App } from 'aws-cdk-lib';
import { MbqStack } from '../lib/mbq-stack';

// One stack per stage. Deploy with:
//   npx cdk deploy -c stage=staging -c adminEmail=you@example.com   (adminEmail is optional)
const app = new App();
const stage = (app.node.tryGetContext('stage') as string) || 'staging';
if (!['staging', 'prod'].includes(stage)) throw new Error('stage must be "staging" or "prod"');
const adminEmail = app.node.tryGetContext('adminEmail') as string | undefined;
if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('adminEmail is not a valid email address');

new MbqStack(app, `MyBigQuest-${stage}`, {
  stage: stage as 'staging' | 'prod',
  adminEmail,
  // Environment-agnostic on purpose: synth makes no AWS lookups, and the account/region
  // come from the AWS profile used at deploy time (AZs resolve via Fn::GetAZs).
  description: `My Big Quest web app (${stage})`,
});
