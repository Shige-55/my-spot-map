import { appendFileSync } from 'node:fs';
import { assertPublishTarget, loadPagesTarget } from '../build/pagesConfig.js';

const target = loadPagesTarget();
if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
  assertPublishTarget(target, { repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF });
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `base=${target.base}\nsite_url=${target.siteUrl}\n`);
}
process.stdout.write(`公開準備対象: ${target.fullName} / ${target.branch} / ${target.base}\n`);
