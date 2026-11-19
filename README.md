# My Big Quest

A web app that helps students in grades 6–12 find the gaps in their college plan, talk to mentors, and read short tips.
Built from the design prototypes in [`prototype/`](prototype/) (kept for reference only).

It runs on AWS with **no servers and no Lambda functions**: CloudFront serves the site from S3, and API Gateway writes form data straight into DynamoDB.

## What's in it

| Folder | What it is |
| --- | --- |
| `web/` | React + TypeScript app (Vite): Home, GapFinder quiz, Mentors, Tips, and an `/admin` page |
| `shared/` | Quiz content and scoring, the mentor list, and the JSON schemas every request is checked against |
| `infra/` | AWS CDK stack: S3, CloudFront, API Gateway, DynamoDB and Cognito. `lib/templates.ts` holds the API Gateway → DynamoDB mappings |
| `mock-api/` | A local stand-in for the AWS API, for development only. Never deployed |
| `scripts/deploy.mjs` | The deploy script |

### How it works

```
Browser → CloudFront ─┬─ /*      → S3 (the React app)
                      └─ /api/*  → API Gateway → DynamoDB
                                    └─ /api/admin/* needs a Cognito sign-in
```

Students don't sign up. They type their name before the quiz starts, each browser gets a random id, and the quiz autosaves as they answer. API Gateway checks every request against the JSON schemas in `shared/src/schemas.ts` (for example, only real question and answer ids are accepted), then a mapping template turns it into a DynamoDB call.

| DynamoDB table | Holds |
| --- | --- |
| Quiz sessions | The student's name, their answers, how far they got, and when they finished. A browser can only update its own session |
| Feedback | The post-quiz feedback form |
| Mentor requests | Chat requests, with the parent or guardian's email |

The admin page reads these tables and works out the stats (gaps per area, ratings) in the browser. Overview, Feedback and Quiz sessions each have a **Download CSV** button (built in the browser too, in `shared/src/csv.ts`) that opens in Excel or Google Sheets. The Overview file is totals only, by grade, with no personal data, so it's the one to share. Quiz sessions can also be downloaded without names. Mentor requests can't be downloaded, so parents' emails stay behind the admin sign-in. The mentor list is part of the site (`shared/src/mentors.ts`).

## Run it locally

Needs Node 22+.

```bash
npm install
npm run dev:api
npm run dev:web
```

Open http://localhost:5173. `dev:api` runs the mock API, which keeps data in `.local/mock-db.json` (delete it to start fresh). Locally, `/admin` opens without signing in (`web/public/config.json` says `"mode": "dev"`).

Tests (no AWS or database needed):

```bash
npm test
```

They cover the quiz scoring, the request schemas, the mock API, and the API Gateway mapping templates (rendered with a Velocity engine, including text with quotes, newlines and emoji).

## Deploy to AWS

Deploy with the script. It checks your AWS access, typechecks, tests, builds the web app, runs `cdk deploy`, uploads the site to S3, clears the CloudFront cache, then smoke-tests the live site:

```bash
npm run deploy -- staging --admin-email you@example.com
```

That's the first deploy. `--admin-email` creates the first admin, and Cognito emails them a temporary password. Add `--bootstrap` if the AWS account and region have never been set up for CDK. The first deploy takes about 5–10 minutes, mostly CloudFront.

After that:

```bash
npm run deploy -- staging
```

```bash
npm run deploy -- prod
```

Prod asks you to type `prod` to confirm, refuses uncommitted changes, and always runs the tests. Prod tables have deletion protection and point-in-time recovery, and are kept if the stack is deleted.

| Option | What it does |
| --- | --- |
| `--profile <name>` / `--region <region>` | Which AWS profile and region to use |
| `--dry-run` | Checks, tests, build and `cdk synth` only. Makes no AWS calls |
| `--yes` | No confirmation prompt; approves IAM changes automatically (for CI) |
| `--skip-tests` | Skip typecheck and tests (staging only) |
| `--allow-dirty` | Let prod deploy with uncommitted changes |

Run `npm run deploy -- --help` for the full list. The stack's outputs are saved to `.local/outputs-<stage>.json`, and the deploy prints the site and admin URLs.

Cost at low traffic is close to $0: DynamoDB, API Gateway and CloudFront are pay-per-request, and Cognito is free for a handful of admins.

The site's S3 bucket is kept if the stack is deleted (emptying it automatically would need a Lambda). Empty and delete it by hand if you tear a stage down.

### Admin sign-in

Admins sign in with Amazon Cognito at `<site>/admin`. Everyone in the stage's Cognito user pool is an admin, and there's no sign-up, so admins have to be invited:

1. Open the Cognito console, then the user pool named `my-big-quest-admins-<stage>`.
2. **Create user**: enter their email and choose **Send an email invitation**.

Or with the AWS CLI:

```bash
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username person@example.com --user-attributes Name=email,Value=person@example.com Name=email_verified,Value=true --desired-delivery-mediums EMAIL
```

On first sign-in they set their own password. Admins can turn on an authenticator-app code (MFA) in Cognito. To remove someone, delete or disable their user.

API Gateway checks the Cognito sign-in on every `/api/admin/*` request. The admin page sends its token in an `X-Auth` header, which CloudFront forwards to API Gateway.

## Not done yet

- Emails: mentor requests are saved and shown on `/admin`, but nothing is emailed yet (planned: Amazon SES).
- Custom domain: the site uses the CloudFront `*.cloudfront.net` address until a domain and certificate are added.
- The admin page reads each table in one request (up to 1 MB of data, thousands of rows). Paging will be needed if it grows past that.
- CI/CD (GitHub Actions) for automatic deploys.
