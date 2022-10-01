import { Writable } from "node:stream";
import { runTask } from "./runner";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import Debug from "debug";
const debug = Debug("actions:github");

// Clone the moonbeam repo and setup no branch
export const cloneMoonbeam = async function (
  authorizedUrl: string,
  owner: string,
  repo: string,
  directory: string
): Promise<string> {
  await fs.mkdir(directory, { recursive: true });
  const repoDirectory = path.join(directory, repo);
  debug(`push domain: ${authorizedUrl.replace(/token[^@]*@/g, "")}`);
  try {
    await runTask(
      `git clone ${authorizedUrl}/${owner}/${repo} ${repoDirectory}`,
      { cwd: directory }
    );
  } catch (error) {
    // if dest path has a .git dir, ignore
    // this error handling prevents subsequent git commands from interacting with the wrong repo
    if (!(await fs.lstat(repoDirectory + "/.git")).isDirectory()) {
      throw error;
    }
  }

  await runTask("git submodule update --init", { cwd: repoDirectory });
  await runTask("git add . && git reset --hard HEAD", { cwd: repoDirectory });
  const detachedHead = (
    await runTask("git rev-parse HEAD", { cwd: repoDirectory })
  ).trim();

  // Check out to the detached head so that any branch can be deleted
  await runTask(`git checkout ${detachedHead}`, { cwd: repoDirectory });
  return repoDirectory;
};

export const addRemote = async function (
  repositoryPath: string,
  remoteName: string,
  authorizedUrl: string,
  owner: string,
  repo: string
): Promise<void> {
  debug(`Add remote ${remoteName} ${owner}/${repo}`);
  await runTask(`git remote remove ${remoteName} || true`, {
    cwd: repositoryPath,
  });
  await runTask(
    `git remote add ${remoteName} ${authorizedUrl}/${owner}/${repo}.git`,
    { cwd: repositoryPath }
  );
};

export const setupBranch = async function (
  repositoryPath: string,
  remoteName: string,
  branch: string
): Promise<void> {
  debug(`Setup branch ${branch}`);
  // Fetch and recreate the PR's branch
  await runTask(`git branch -D ${branch} || true`, { cwd: repositoryPath });
  await runTask(
    `git fetch ${remoteName} ${branch} && git checkout --track ${remoteName}/${branch}`,
    { cwd: repositoryPath },
    `Checking out ${branch}...`
  );
  await runTask(
    `git branch | grep ${branch} && git checkout ${branch} || git checkout -b ${branch}`,
    { cwd: repositoryPath }
  );
};

export const createBranch = async function (
  repositoryPath: string,
  branch: string
): Promise<void> {
  debug(`Create branch ${branch}`);
  await runTask(`git checkout -b ${branch}`, { cwd: repositoryPath });
};
