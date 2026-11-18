import { App } from 'aws-cdk-lib';
import { MbqStack } from '../lib/mbq-stack';

// One stack per stage. Deploy with:  npx cdk deploy -c stage=staging   (or -c stage=prod)
const app = new App();
const stage = (app.node.tryGetContext('stage') as string) || 'staging';
if (!['staging', 'prod'].includes(stage)) throw new Error('stage must be "staging" or "prod"');

new MbqStack(app, `MyBigQuest-${stage}`, {
  stage: stage as 'staging' | 'prod',
  // Environment-agnostic on purpose: synth makes no AWS lookups, and the account/region
  // come from the AWS profile used at deploy time (AZs resolve via Fn::GetAZs).
  description: `My Big Quest web app (${stage})`,
});
