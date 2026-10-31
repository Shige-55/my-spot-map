import { readFileSync } from 'node:fs';

export function resolvePagesTarget(config) {
  if (!config || typeof config !== 'object') throw new Error('公開先設定がありません。');
  const { owner, repository, branch } = config;
  if (typeof owner !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)
    || typeof repository !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(repository) || ['.', '..'].includes(repository)
    || typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)
    || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.') || branch.endsWith('.lock')) {
    throw new Error('pages.config.jsonの所有者・リポジトリ・ブランチ設定が正しくありません。');
  }
  const base = repository.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '/' : `/${repository}/`;
  return Object.freeze({ owner, repository, branch, base,
    fullName: `${owner}/${repository}`, ref: `refs/heads/${branch}`,
    remote: `https://github.com/${owner}/${repository}.git`,
    siteUrl: `https://${owner.toLowerCase()}.github.io${base}`,
  });
}

export function loadPagesTarget() {
  return resolvePagesTarget(JSON.parse(readFileSync(new URL('../pages.config.json', import.meta.url), 'utf8')));
}

export function assertPublishTarget(target, { repository, ref }) {
  if (repository?.toLowerCase() !== target.fullName.toLowerCase() || ref !== target.ref) {
    throw new Error(`公開先リポジトリまたはブランチが設定と一致しません。${target.fullName}の${target.branch}から公開してください。`);
  }
}
