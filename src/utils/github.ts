export const COMMENT_MAX_LENGTH = 65536;
export const COMMENT_TRUNCATED_POSTFIX = "<truncated>...";

import { createAppAuth, StrategyOptions } from "@octokit/auth-app";
import {
  AuthInterface,
  InstallationAccessTokenAuthentication,
} from "@octokit/auth-app/dist-types/types";
import { Octokit } from "octokit";
import moment from "moment";
import { Service } from "./service";

export class OctokitService implements Service {
  public isReady: Promise<OctokitService>;
  private installationId: string | number;
  public repo: string;
  public owner: string;
  private app: AuthInterface;
  private jwt: InstallationAccessTokenAuthentication;
  private octokit: Octokit;

  constructor(
    owner: string,
    repo: string,
    installationId: number | string,
    options: StrategyOptions
  ) {
    this.owner = owner;
    this.repo = repo;
    this.installationId = installationId;
    this.app = createAppAuth(options);
    this.isReady = this.checkAuth().then(() => this);
  }

  async checkAuth() {
    if (
      this.jwt &&
      moment(new Date()).add(30, "seconds").isBefore(this.jwt.expiresAt)
    ) {
      return;
    }

    console.log(`Generating new token for ${this.owner}/${this.repo}`);
    this.jwt = await this.app({
      type: "installation",
      installationId: this.installationId,
    });
    this.octokit = new Octokit({ auth: this.jwt.token });
  }

  async getOctokit() {
    await this.checkAuth();
    return this.octokit;
  }

  async getAuthorizedUrl() {
    await this.checkAuth();
    return `https://x-access-token:${this.jwt.token}@github.com/`;
  }

  extendRepoOwner<T>(data: T): T & { owner: string; repo: string } {
    return { owner: this.owner, repo: this.repo, ...data };
  }

  async destroy() {}
}
