#!/usr/bin/env node
// Deploys My Big Quest to AWS: checks, tests, builds the web app, runs `cdk deploy`, then smoke-tests the site.
//
//   npm run deploy -- staging
//   npm run deploy -- staging --admin-email you@example.com     (first deploy: invites the first admin)
//   npm run deploy -- prod --profile mbq-prod
//   npm run deploy -- staging --dry-run                          (no AWS calls: checks, build and synth only)
//
// Run `npm run deploy -- --help` for all options.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const ROOT = resolve(import.meta.dirname, '..');
const INFRA = join(ROOT, 'infra');
const IS_WIN = process.platform === 'win32';

const HELP = `Usage: npm run deploy -- <staging|prod> [options]

Options:
  --admin-email <email>  Create this person as the first admin (Cognito emails an invite). First deploy only.
  --profile <name>       AWS CLI profile to use (default: your default profile / AWS_PROFILE)
  --region <region>      AWS region (default: the profile's region)
  --yes                  Don't ask for confirmation; approve IAM/security changes automatically
  --skip-tests           Skip typecheck and tests (not allowed for prod)
  --allow-dirty          Deploy prod with uncommitted changes
  --bootstrap            Run "cdk bootstrap" first if the account/region isn't bootstrapped
  --dry-run              Run checks, tests, build and "cdk synth" only. Makes no AWS calls.
  -h, --help             Show this help`;

// ---------- helpers ----------
const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c(1), green = c(32), yellow = c(33), red = c(31), dim = c(2);
let stepNo = 0;
const step = (msg) => console.log('\n' + bold(`[${++stepNo}] ${msg}`));
const info = (msg) => console.log('    ' + msg);
const warn = (msg) => console.log('    ' + yellow('! ' + msg));
function fail(msg) {
  console.error('\n' + red('✖ ' + msg));
  process.exit(1);
}

/** Runs a command with live output. Throws (exits) on failure unless allowFail. */
function run(cmd, args, { cwd = ROOT, env = {}, allowFail = false, capture = false } = {}) {
  if (!capture) console.log(dim(`    $ ${cmd} ${args.join(' ')}`));
  // npm/npx are .cmd shims on Windows and need a shell; every argument here is validated first.
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: IS_WIN,
  });
  if (r.error) {
    if (allowFail) return r;
    fail(`Could not run "${cmd}": ${r.error.message}`);
  }
  if (r.status !== 0 && !allowFail) fail(`"${cmd} ${args.join(' ')}" failed (exit ${r.status}).${capture ? '\n' + (r.stderr || r.stdout) : ''}`);
  return r;
}

async function confirm(question, expected) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('\n' + bold(question) + ' ')).trim();
  rl.close();
  return expected ? answer === expected : /^y(es)?$/i.test(answer);
}

// ---------- arguments ----------
function parseArgs(argv) {
  const o = { stage: null, adminEmail: null, profile: null, region: null, yes: false, skipTests: false, allowDirty: false, bootstrap: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) fail(`${a} needs a value`);
      return v;
    };
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '--admin-email') o.adminEmail = val();
    else if (a === '--profile') o.profile = val();
    else if (a === '--region') o.region = val();
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--skip-tests') o.skipTests = true;
    else if (a === '--allow-dirty') o.allowDirty = true;
    else if (a === '--bootstrap') o.bootstrap = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (!a.startsWith('-') && !o.stage) o.stage = a;
    else fail(`Unknown argument: ${a}\n\n${HELP}`);
  }
  if (!o.stage) fail(`Say which stage to deploy.\n\n${HELP}`);
  if (!['staging', 'prod'].includes(o.stage)) fail(`Stage must be "staging" or "prod", not "${o.stage}".`);
  // These end up on a command line, so only allow plain values.
  if (o.adminEmail && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(o.adminEmail)) fail(`"${o.adminEmail}" doesn't look like an email address.`);
  if (o.profile && !/^[A-Za-z0-9._-]+$/.test(o.profile)) fail(`Invalid profile name "${o.profile}".`);
  if (o.region && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(o.region)) fail(`Invalid region "${o.region}" (expected something like us-east-1).`);
  if (o.stage === 'prod' && o.skipTests) fail('--skip-tests is not allowed for prod.');
  return o;
}

// ---------- main ----------
const opt = parseArgs(process.argv.slice(2));
const prod = opt.stage === 'prod';
const stackName = `MyBigQuest-${opt.stage}`;
const awsEnv = { ...(opt.profile && { AWS_PROFILE: opt.profile }), ...(opt.region && { AWS_REGION: opt.region, AWS_DEFAULT_REGION: opt.region }) };
const awsArgs = [...(opt.profile ? ['--profile', opt.profile] : []), ...(opt.region ? ['--region', opt.region] : [])];

console.log(bold(`\nDeploying My Big Quest → ${opt.stage}${opt.dryRun ? ' (dry run: no AWS changes)' : ''}`));

step('Checking tools and the repo');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) fail(`Node 22 or newer is needed (you have ${process.versions.node}).`);
info(`node ${process.versions.node}`);
if (!existsSync(join(ROOT, 'node_modules', 'aws-cdk-lib'))) fail('Dependencies are missing. Run "npm install" first.');
if (!opt.dryRun) {
  const aws = run('aws', ['--version'], { capture: true, allowFail: true });
  if (aws.status !== 0) fail('The AWS CLI is needed: https://aws.amazon.com/cli/');
  info(aws.stdout.trim().split(' ')[0]);
}
const git = run('git', ['status', '--porcelain'], { capture: true, allowFail: true });
const dirty = git.status === 0 && git.stdout.trim() !== '';
const commit = run('git', ['rev-parse', '--short', 'HEAD'], { capture: true, allowFail: true }).stdout?.trim() || 'unknown';
const branch = run('git', ['branch', '--show-current'], { capture: true, allowFail: true }).stdout?.trim() || 'unknown';
info(`git ${branch} @ ${commit}${dirty ? yellow(' (uncommitted changes)') : ''}`);
if (dirty && prod && !opt.allowDirty && !opt.dryRun) fail('Commit your changes before deploying to prod (or pass --allow-dirty).');
if (dirty) warn('Deploying uncommitted changes.');

let account = null, region = opt.region;
if (!opt.dryRun) {
  step('Checking AWS access');
  const id = run('aws', ['sts', 'get-caller-identity', '--output', 'json', ...awsArgs], { capture: true, allowFail: true });
  if (id.status !== 0) fail(`Can't use your AWS credentials${opt.profile ? ` (profile "${opt.profile}")` : ''}. Run "aws configure" or "aws sso login".\n${id.stderr}`);
  const who = JSON.parse(id.stdout);
  account = who.Account;
  if (!region) region = run('aws', ['configure', 'get', 'region', ...awsArgs], { capture: true, allowFail: true }).stdout?.trim();
  if (!region) fail('No AWS region set. Pass --region or set one with "aws configure".');
  info(`account ${account}, region ${region}`);
  info(`as ${who.Arn}`);

  const boot = run('aws', ['cloudformation', 'describe-stacks', '--stack-name', 'CDKToolkit', '--query', 'Stacks[0].StackStatus', '--output', 'text', ...awsArgs, '--region', region], { capture: true, allowFail: true });
  if (boot.status !== 0) {
    if (!opt.bootstrap) fail(`This account/region isn't set up for CDK yet. Run once with --bootstrap (needs admin-level access), or:\n    npx cdk bootstrap aws://${account}/${region}`);
    step('Bootstrapping CDK (one-time setup)');
    run('npx', ['cdk', 'bootstrap', `aws://${account}/${region}`], { cwd: INFRA, env: awsEnv });
  } else {
    info(`CDK bootstrap: ${boot.stdout.trim()}`);
  }

  const existing = run('aws', ['cloudformation', 'describe-stacks', '--stack-name', stackName, '--query', 'Stacks[0].StackStatus', '--output', 'text', ...awsArgs, '--region', region], { capture: true, allowFail: true });
  info(`stack ${stackName}: ${existing.status === 0 ? existing.stdout.trim() : 'not created yet (first deploy)'}`);
  if (existing.status === 0 && opt.adminEmail) fail('--admin-email is only for the first deploy. To add more admins, create them in Cognito and add them to the "admins" group (see README).');
  if (existing.status !== 0 && !opt.adminEmail) warn('First deploy without --admin-email: nobody will be able to sign in to /admin until you add a user to the "admins" group in Cognito.');

  const summary = [`stage ${opt.stage}`, `account ${account}`, `region ${region}`, `commit ${commit}${dirty ? ' + uncommitted changes' : ''}`, ...(opt.adminEmail ? [`first admin ${opt.adminEmail}`] : [])].join(', ');
  if (!opt.yes) {
    const ok = prod
      ? await confirm(`Deploying to PRODUCTION (${summary}). Type "prod" to continue:`, 'prod')
      : await confirm(`Deploy ${summary}? [y/N]`);
    if (!ok) fail('Cancelled.');
  }
}

if (opt.skipTests) {
  warn('Skipping typecheck and tests (--skip-tests).');
} else {
  step('Typechecking');
  run('npm', ['run', 'typecheck']);
  step('Running tests');
  run('npm', ['test']);
}

step('Building the web app');
run('npm', ['run', 'build', '-w', 'web']);

const cdkContext = ['-c', `stage=${opt.stage}`, ...(opt.adminEmail ? ['-c', `adminEmail=${opt.adminEmail}`] : [])];
if (opt.dryRun) {
  step('Synthesizing the CloudFormation template (dry run)');
  run('npx', ['cdk', 'synth', stackName, ...cdkContext, '--quiet'], { cwd: INFRA });
  console.log('\n' + green(`✔ Dry run passed. Template: infra/cdk.out/${stackName}.template.json`));
  console.log('  Run without --dry-run to deploy.');
  process.exit(0);
}

step(`Deploying ${stackName} (the first deploy takes about 5–10 minutes, mostly CloudFront)`);
mkdirSync(join(ROOT, '.local'), { recursive: true });
const outputsFile = join(ROOT, '.local', `outputs-${opt.stage}.json`);
const started = Date.now();
run('npx', ['cdk', 'deploy', stackName, ...cdkContext,
  '--require-approval', opt.yes ? 'never' : 'broadening',
  '--outputs-file', outputsFile,
  ...(opt.profile ? ['--profile', opt.profile] : []),
], { cwd: INFRA, env: { ...awsEnv, AWS_REGION: region, AWS_DEFAULT_REGION: region, CDK_DEFAULT_REGION: region } });
info(`done in ${Math.round((Date.now() - started) / 60000)} min`);

const outputs = JSON.parse(readFileSync(outputsFile, 'utf8'))[stackName] ?? {};
const url = outputs.Url;
for (const k of ['Url', 'SiteBucket', 'DistributionId', 'UserPoolClientId', 'CognitoDomain']) {
  if (!outputs[k]) fail(`Deploy finished but the "${k}" output is missing from ${outputsFile}.`);
}

// There's no Lambda to copy files, so the site is uploaded here with the AWS CLI.
step('Uploading the site to S3');
const dist = join(ROOT, 'web', 'dist');
writeFileSync(join(dist, 'config.json'), JSON.stringify({ mode: 'cognito', domain: outputs.CognitoDomain, clientId: outputs.UserPoolClientId }, null, 2) + '\n');
info('wrote config.json (admin sign-in settings)');
const s3 = `s3://${outputs.SiteBucket}`;
const awsDeployArgs = [...(opt.profile ? ['--profile', opt.profile] : []), '--region', region];
// Hashed files under assets/ never change, so browsers can keep them; everything else is revalidated.
run('aws', ['s3', 'sync', join(dist, 'assets'), `${s3}/assets`, '--delete', '--cache-control', 'public,max-age=31536000,immutable', ...awsDeployArgs]);
run('aws', ['s3', 'sync', dist, s3, '--delete', '--exclude', 'assets/*', '--cache-control', 'no-cache', ...awsDeployArgs]);
run('aws', ['cloudfront', 'create-invalidation', '--distribution-id', outputs.DistributionId, '--paths', '/*', '--query', 'Invalidation.Id', '--output', 'text', ...(opt.profile ? ['--profile', opt.profile] : [])]);

step('Smoke-testing the live site');
async function check(path, test, { tries = 10, method = 'GET', body } = {}) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url + path, { method, body, headers: body ? { 'content-type': 'application/json' } : {}, signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      if (test(res, text)) return info(green('✔ ') + `${path} → ${res.status}`);
      if (i === tries) return warn(`${path} → ${res.status}: ${text.slice(0, 120)}`);
    } catch (e) {
      if (i === tries) return warn(`${path} → ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 15000)); // CloudFront can take a few minutes on first deploy
  }
}
await check('/', (r, b) => r.ok && b.includes('<div id="root">'));
await check('/mentors', (r, b) => r.ok && b.includes('<div id="root">'));
await check('/config.json', (r, b) => r.ok && b.includes('"cognito"'));
await check('/api/admin/sessions', (r) => r.status === 401);
// An invalid body is rejected by API Gateway's validation, so this check never writes anything.
await check('/api/sessions', (r) => r.status === 400, { method: 'PUT', body: '{"id":"smoke-test"}' });

console.log('\n' + green(bold(`✔ Deployed ${opt.stage}`)));
console.log(`
  Site:       ${url}
  Admin:      ${outputs.AdminUrl}
  User pool:  ${outputs.UserPoolId}   (everyone in this Cognito pool is an admin)
  Outputs:    .local/outputs-${opt.stage}.json
${opt.adminEmail ? `\n  An invite with a temporary password was emailed to ${opt.adminEmail}.` : ''}`);
